import {useState} from "react";

import {PageIntro} from "../components/Layout";
import {LookupKindToggle} from "../components/LookupKindToggle";
import {TranslationTool} from "../components/ModelTools";
import {OrthographyTool} from "../components/OrthographyTool";
import {Recorder} from "../components/Recorder";
import {SearchTool, type LookupKind} from "../components/SearchTool";
import {StudyDeck} from "../components/StudyDeck";
import {useI18n} from "../i18n";
import {useSearchParams} from "../routing";
import type {AppData, DictionaryEntry, SearchRecord} from "../types";

type StudioTab = "lookup" | "deck" | "practice" | "translation" | "orthography" | "lessons";

export function Learn({data}: {data: AppData}) {
  const {dialectName, languageName, t, tx} = useI18n();
  const [params] = useSearchParams();
  const amis = data.languages.find((language) => language.name === "Amis");
  const requestedLanguage = params.get("language");
  const initialLanguage = data.languages.find((language) => language.id === requestedLanguage) ?? amis ?? data.languages[0];
  const [languageId, setLanguageId] = useState(initialLanguage?.id ?? "");
  const language = data.languages.find((item) => item.id === languageId) ?? data.languages[0];
  const requestedDialect = params.get("dialect") ?? "";
  const [dialect, setDialect] = useState(
    initialLanguage?.dialects.includes(requestedDialect) ? requestedDialect : "",
  );
  const requestedTool = params.get("tool") as StudioTab | null;
  const [tab, setTab] = useState<StudioTab>(
    requestedTool && ["lookup", "deck", "practice", "translation", "orthography", "lessons"].includes(requestedTool)
      ? requestedTool
      : "lookup",
  );
  const requestedLookupKind = params.get("type");
  const [lookupKind, setLookupKind] = useState<LookupKind>(
    requestedLookupKind === "sentences" ? "sentences" : "dictionary",
  );
  const [pendingSentenceQuery, setPendingSentenceQuery] = useState<string | null>(null);
  const [practiceTarget, setPracticeTarget] = useState("");
  function changeLanguage(nextId: string) {
    setLanguageId(nextId);
    setDialect("");
    setPendingSentenceQuery(null);
  }

  function selectLookupKind(nextKind: LookupKind) {
    setPendingSentenceQuery(null);
    setLookupKind(nextKind);
  }

  function viewSentences(entry: DictionaryEntry) {
    if (entry.language_id !== languageId) changeLanguage(entry.language_id);
    setPendingSentenceQuery(entry.headword);
    setLookupKind("sentences");
    setTab("lookup");
  }

  function practice(record: SearchRecord) {
    setPracticeTarget(record.standard || record.original);
    setTab("practice");
  }
  const tabs: Array<[StudioTab, string]> = [
    ["lookup", tx("Lookup", "查詢")],
    ["deck", t("learn.deck")],
    ["practice", t("learn.practice")],
    ["translation", tx("Translation", "機器翻譯")],
    ["orthography", t("learn.orthography")],
    ["lessons", tx("Notes", "筆記")],
  ];
  return (
    <div className="page-wrap page-wrap--wide learner-page">
      <PageIntro title={t("learn.title")} />
      {language && (
        <section className="learner-toolbar" aria-label={tx("Learning context", "學習範圍")}>
          <label className="field">
            {tx("Formosan language", "臺灣南島語")}
            <select value={language.id} onChange={(event) => changeLanguage(event.target.value)}>
              {data.languages.map((item) => <option key={item.id} value={item.id}>{languageName(item)}</option>)}
            </select>
          </label>
          {language.dialects.length > 0 && (
            <label className="field">
              {tx("Dialect", "方言")}
              <select value={dialect} onChange={(event) => setDialect(event.target.value)}>
                <option value="">{tx("All dialects", "所有方言")}</option>
                {language.dialects.map((value) => <option key={value} value={value}>{dialectName(value)}</option>)}
              </select>
            </label>
          )}
        </section>
      )}
      <div className="studio-tabs" role="tablist" aria-label={tx("Learner tools", "學習工具")}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`studio-${id}`}
            onClick={() => {
              if (id !== "lookup") setPendingSentenceQuery(null);
              setTab(id);
            }}
          >
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="studio-panel" id={`studio-${tab}`} role="tabpanel">
        {tab === "lookup" && (
          <>
            <LookupKindToggle kind={lookupKind} onChange={selectLookupKind} />
            <div id="lookup-results">
              <SearchTool
                key={`${lookupKind}-${languageId}-${dialect}-${pendingSentenceQuery ?? ""}`}
                data={data}
                kind={lookupKind}
                learner
                autoSearch={pendingSentenceQuery !== null}
                selectedLanguageId={languageId}
                selectedDialect={dialect}
                onPractice={practice}
                onViewSentences={viewSentences}
                {...(pendingSentenceQuery !== null && {initialQuery: pendingSentenceQuery})}
              />
            </div>
          </>
        )}
        {tab === "deck" && (
          <StudyDeck currentRelease={data.meta.release_id} languageId={languageId} dialect={dialect} />
        )}
        {tab === "practice" && <Recorder key={`${languageId}-${practiceTarget}`} catalog={data.models} selectedLanguage={language?.name ?? "Amis"} referenceText={practiceTarget} />}
        {tab === "translation" && (
          <TranslationTool
            catalog={data.models}
            languages={data.languages}
            selectedLanguageId={languageId}
            selectedDialect={dialect}
          />
        )}
        {tab === "orthography" && (
          <OrthographyTool
            key={`${languageId}-${dialect}`}
            catalog={data.orthography}
            sourceCommit={data.meta.source.commit}
            languageName={language?.name ?? "Amis"}
            selectedDialect={dialect}
          />
        )}
        {tab === "lessons" &&
          (data.content.entries.length ? (
            <div className="reviewed-content">
              {data.content.entries.map((entry) => (
                <article key={entry.id}>
                  <p className="eyebrow">
                    {entry.kind} · reviewed {entry.reviewed_at}
                  </p>
                  <h2>{entry.title}</h2>
                  <p>{entry.summary}</p>
                  <div className="reviewed-content__body">{entry.body_markdown}</div>
                  <h3>{tx("Sources and review", "來源與審查")}</h3>
                  <ul>
                    {entry.citations.map((citation) => (
                      <li key={citation}>{citation}</li>
                    ))}
                  </ul>
                  <small>
                    {tx("By", "作者")} {entry.author}；{tx("reviewed by", "審查者")} {entry.reviewer}；
                    {tx("rights", "權利")}{" "}
                    {entry.rights.license_expression ?? tx("documented in cited evidence", "記載於引用證據")}
                  </small>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <h2>{tx("No reviewed notes yet", "目前沒有已審查筆記")}</h2>
              <p>
                {tx(
                  "Community-authored notes will appear here after review.",
                  "社群撰寫的筆記會在審查後顯示於此。",
                )}
              </p>
              <a href="https://github.com/FormosanBank/kakarayan/blob/main/content/README.md">
                {tx("Read the contribution requirements", "閱讀投稿要求")}
              </a>
            </div>
          ))}
      </div>
    </div>
  );
}
