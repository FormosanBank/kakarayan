import {
  normalizeSearch,
  translationTextMatches,
  type SearchDirection,
  type SearchMode,
} from "../data";
import {useI18n} from "../i18n";
import {Link} from "../routing";
import {translationLanguageName} from "../translationLanguages";
import type {AppData, SearchRecord, Token} from "../types";

interface Candidate {
  key: string;
  label: string;
  records: SearchRecord[];
}

function distance(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  let previous = b.map((_, index) => index + 1);
  previous.unshift(0);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current.push(
        Math.min(
          (current[column - 1] ?? a.length + b.length) + 1,
          (previous[column] ?? a.length + b.length) + 1,
          (previous[column - 1] ?? a.length + b.length) +
            (a[row - 1] === b[column - 1] ? 0 : 1),
        ),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? a.length + b.length;
}

function matchingToken(record: SearchRecord, query: string, mode: SearchMode): Token | undefined {
  const needle = normalizeSearch(query);
  if (mode === "fuzzy") {
    return [...record.tokens].sort(
      (left, right) =>
        distance(left.normalized, needle) - distance(right.normalized, needle) ||
        left.position - right.position,
    )[0];
  }
  return record.tokens.find((item) =>
    mode === "prefix" ? item.normalized.startsWith(needle) : item.normalized === needle,
  );
}

function candidateFor(
  record: SearchRecord,
  query: string,
  mode: SearchMode,
): {key: string; label: string} | null {
  const token = matchingToken(record, query, mode);
  if (token) return {key: token.normalized, label: token.surface};
  const needle = normalizeSearch(query);
  const form = record.forms.find(
    (item) =>
      item.owner_type !== "sentence" &&
      (mode === "prefix"
        ? item.normalized.startsWith(needle)
        : mode === "fuzzy"
          ? distance(item.normalized, needle) <= (needle.length <= 4 ? 1 : 2)
          : item.normalized === needle),
  );
  if (form) return {key: form.normalized, label: form.text};
  return null;
}

function reverseCandidatesFor(
  record: SearchRecord,
  query: string,
  mode: SearchMode,
  targetLanguage: string,
): Array<{key: string; label: string}> {
  const candidates = new Map<string, {key: string; label: string}>();
  const matchingLexicalTranslations = record.tier_translations.filter(
    (item) =>
      item.owner_type !== "sentence" &&
      (!targetLanguage || item.xml_lang === targetLanguage) &&
      translationTextMatches(item.text, query, mode),
  );
  for (const translation of matchingLexicalTranslations) {
    for (const form of record.forms) {
      if (form.owner_id !== translation.owner_id || !form.normalized) continue;
      candidates.set(form.normalized, {key: form.normalized, label: form.text});
    }
    if (translation.owner_type === "word") {
      for (const token of record.tokens) {
        if (token.word_id === translation.owner_id && token.normalized) {
          candidates.set(token.normalized, {key: token.normalized, label: token.surface});
        }
      }
    }
  }

  const sentenceMeaningMatches = record.translations.some(
    (item) =>
      (!targetLanguage || item.xml_lang === targetLanguage) &&
      translationTextMatches(item.text, query, mode),
  );
  if (sentenceMeaningMatches && record.tokens.length === 1) {
    const token = record.tokens[0];
    if (token?.normalized) {
      candidates.set(token.normalized, {key: token.normalized, label: token.surface});
    }
  }
  if (sentenceMeaningMatches && record.tokens.length === 0) {
    const label = record.standard || record.original;
    const key = normalizeSearch(label);
    if (key && !/\s/u.test(key)) candidates.set(key, {key, label});
  }
  return [...candidates.values()];
}

function groups(
  records: SearchRecord[],
  query: string,
  mode: SearchMode,
  direction: SearchDirection,
  targetLanguage: string,
): Candidate[] {
  const values = new Map<string, Candidate>();
  for (const record of records) {
    const candidates = direction === "translation"
      ? reverseCandidatesFor(record, query, mode, targetLanguage)
      : [candidateFor(record, query, mode)].filter(
          (candidate): candidate is {key: string; label: string} => candidate !== null,
        );
    for (const candidate of candidates) {
      const existing = values.get(candidate.key);
      if (existing) {
        if (!existing.records.some((item) => item.id === record.id)) {
          existing.records.push(record);
        }
      } else {
        values.set(candidate.key, {...candidate, records: [record]});
      }
    }
  }
  return [...values.values()].sort(
    (left, right) =>
      right.records.length - left.records.length || left.key.localeCompare(right.key),
  );
}

function meaningsForRecord(
  record: SearchRecord,
  candidate: Candidate,
  targetLanguage: string,
): string[] {
  const meanings = new Set<string>();
  const tokens = record.tokens.filter((item) => item.normalized === candidate.key);
  const wordIds = new Set(tokens.map((item) => item.word_id));
  const ownerIds = new Set(wordIds);
  for (const form of record.forms) {
    if (form.owner_type !== "sentence" && form.normalized === candidate.key) {
      ownerIds.add(form.owner_id);
      if (form.owner_type === "word") wordIds.add(form.owner_id);
    }
  }
  for (const word of record.words) {
    if (!wordIds.has(word.id)) continue;
    for (const morpheme of word.morphemes) ownerIds.add(morpheme.id);
  }
  for (const item of record.tier_translations) {
    if (
      ownerIds.has(item.owner_id) &&
      (!targetLanguage || item.xml_lang === targetLanguage) &&
      item.text.trim()
    ) {
      meanings.add(item.text.trim());
    }
  }
  const isHeadwordRecord =
    record.tokens.length <= 1 ||
    normalizeSearch(record.standard) === candidate.key ||
    normalizeSearch(record.original) === candidate.key;
  if (isHeadwordRecord) {
    for (const item of record.translations) {
      if ((!targetLanguage || item.xml_lang === targetLanguage) && item.text.trim()) {
        meanings.add(item.text.trim());
      }
    }
  }
  return [...meanings];
}

function evidenceFor(candidate: Candidate, targetLanguage: string) {
  const evidence = candidate.records
    .map((record) => ({record, meanings: meaningsForRecord(record, candidate, targetLanguage)}))
    .filter((item) => item.meanings.length > 0);
  return {
    meanings: [...new Set(evidence.flatMap((item) => item.meanings))],
    cardEvidence: evidence[0] ?? null,
  };
}

function lexicalOwnerIds(record: SearchRecord, candidate: Candidate): Set<string> {
  const wordIds = new Set(
    record.tokens
      .filter((item) => item.normalized === candidate.key)
      .map((item) => item.word_id),
  );
  const owners = new Set(wordIds);
  for (const form of record.forms) {
    if (form.owner_type !== "sentence" && form.normalized === candidate.key) {
      owners.add(form.owner_id);
    }
  }
  for (const word of record.words) {
    if (!wordIds.has(word.id)) continue;
    for (const morpheme of word.morphemes) owners.add(morpheme.id);
  }
  return owners;
}

export function CandidateGroups({
  data,
  records,
  query,
  mode,
  direction,
  targetLanguage,
  corpusId,
  onSave,
}: {
  data: AppData;
  records: SearchRecord[];
  query: string;
  mode: SearchMode;
  direction: SearchDirection;
  targetLanguage: string;
  corpusId: string;
  onSave: (record: SearchRecord, front: string, meanings: string[]) => void;
}) {
  const {locale, number, tx} = useI18n();
  return (
    <div className="candidate-groups">
      {groups(records, query, mode, direction, targetLanguage).map((candidate) => {
        const {meanings, cardEvidence} = evidenceFor(candidate, targetLanguage);
        const firstRecord = candidate.records[0];
        if (!firstRecord) return null;
        const corpora = new Set(candidate.records.map((record) => record.corpus_id));
        const variants = new Set(
          candidate.records
            .flatMap((record) => [
              ...record.tokens
                .filter((item) => item.normalized === candidate.key)
                .map((item) => item.surface),
              ...record.forms
                .filter(
                  (item) =>
                    item.owner_type !== "sentence" && item.normalized === candidate.key,
                )
                .map((item) => item.text),
            ])
            .filter((value) => value && value !== candidate.label),
        );
        const pronunciations = new Set(
          candidate.records.flatMap((record) => {
            const owners = lexicalOwnerIds(record, candidate);
            return record.phonology
              .filter((item) => owners.has(item.owner_id))
              .map((item) => item.text);
          }),
        );
        const sentenceLink = `/lookup?type=sentences&q=${encodeURIComponent(candidate.label)}&language=${encodeURIComponent(
          firstRecord.language_id,
        )}&target=${encodeURIComponent(targetLanguage)}&direction=formosan&mode=exact${
          corpusId ? `&corpus=${encodeURIComponent(corpusId)}` : ""
        }`;
        return (
          <article key={candidate.key} className="dictionary-entry">
            <header>
              <div>
                <h3>{candidate.label}</h3>
              </div>
              <span>
                {number(candidate.records.length)}{" "}
                {tx(candidate.records.length === 1 ? "corpus example" : "corpus examples", "筆語料例句")}
              </span>
            </header>
            <div className="dictionary-entry__meaning">
              <span>{translationLanguageName(targetLanguage, locale)}</span>
              {meanings.length ? (
                <ol>
                  {meanings.slice(0, 8).map((meaning) => <li key={meaning}>{meaning}</li>)}
                </ol>
              ) : (
                <p>{tx("No word-level meaning is tagged in this language.", "此語言沒有標記到詞級釋義。")}</p>
              )}
            </div>
            {(pronunciations.size > 0 || variants.size > 0) && (
              <dl className="dictionary-entry__details">
                {pronunciations.size > 0 && (
                  <div><dt>{tx("Pronunciation", "發音")}</dt><dd>{[...pronunciations].slice(0, 4).join(" · ")}</dd></div>
                )}
                {variants.size > 0 && (
                  <div><dt>{tx("Variants", "變體")}</dt><dd>{[...variants].slice(0, 4).join(" · ")}</dd></div>
                )}
                <div><dt>{tx("Corpora", "語料庫")}</dt><dd>{number(corpora.size)}</dd></div>
              </dl>
            )}
            <footer>
              <Link className="button button--quiet" to={sentenceLink}>
                {tx("View sentences", "查看例句")}
              </Link>
              <button
                className="button button--primary"
                disabled={!cardEvidence}
                onClick={() => {
                  if (cardEvidence) {
                    onSave(cardEvidence.record, candidate.label, cardEvidence.meanings);
                  }
                }}
              >
                {tx("Save word", "儲存單詞")}
              </button>
              <small>
                {tx("Sources:", "來源：")}{" "}
                {[...corpora].map((corpusId, index) => {
                  const corpus = data.corpora.find((item) => item.id === corpusId);
                  return (
                    <span key={corpusId}>
                      {index > 0 && " · "}
                      <Link to={`/corpora/${corpusId}`}>{corpus?.name ?? corpusId}</Link>
                    </span>
                  );
                })}
              </small>
            </footer>
          </article>
        );
      })}
    </div>
  );
}
