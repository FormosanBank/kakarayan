import {useMemo, useState} from "react";

import {PageIntro} from "../components/Layout";
import {LookupKindToggle} from "../components/LookupKindToggle";
import {TranslationTool} from "../components/ModelTools";
import {OrthographyTool} from "../components/OrthographyTool";
import {Recorder} from "../components/Recorder";
import {SearchTool, type LookupKind} from "../components/SearchTool";
import {StudyDeck} from "../components/StudyDeck";
import {useI18n} from "../i18n";
import type {AppData, SearchRecord} from "../types";

type StudioTab = "lookup" | "deck" | "practice" | "translation" | "orthography" | "lessons";

export function Learn({data}: {data: AppData}) {
  const {t, tx} = useI18n();
  const amis = data.languages.find((language) => language.name === "Amis");
  const [languageId, setLanguageId] = useState(amis?.id ?? data.languages[0]?.id ?? "");
  const language = data.languages.find((item) => item.id === languageId) ?? data.languages[0];
  const [dialect, setDialect] = useState(language?.dialects[0] ?? "");
  const [tab, setTab] = useState<StudioTab>("lookup");
  const [lookupKind, setLookupKind] = useState<LookupKind>("dictionary");
  const [practiceTarget, setPracticeTarget] = useState("");
  const capability = useMemo(() => {
    if (!language) return {mt: false, asr: false, orthography: false};
    return {
      mt: data.models.models.some((model) => model.task === "translation" && model.languages.includes(language.iso639_3)),
      asr: data.models.models.some((model) => model.task === "automatic-speech-recognition" && model.languages.includes(language.iso639_3)),
      orthography: data.orthography.tables.some((table) => table.language === language.name),
    };
  }, [data.models.models, data.orthography.tables, language]);

  function changeLanguage(nextId: string) {
    const next = data.languages.find((item) => item.id === nextId);
    setLanguageId(nextId);
    setDialect(next?.dialects[0] ?? "");
  }

  function practice(record: SearchRecord) {
    setPracticeTarget(record.standard || record.original);
    setTab("practice");
  }
  const tabs: Array<[StudioTab, string]> = [
    ["lookup", tx("Lookup", "查詢")],
    ["deck", t("learn.deck")],
    ["practice", t("learn.practice")],
    ["translation", t("learn.translate")],
    ["orthography", t("learn.orthography")],
    ["lessons", tx("Notes", "筆記")],
  ];
  return (
    <div className="page-wrap page-wrap--wide learner-page">
      <PageIntro title={t("learn.title")} lede={t("learn.lede")} />
      {language && (
        <section className="learner-scope" aria-label={tx("Learning language", "學習語言")}>
          <div className="learner-scope__selectors">
            <label className="field">
              {tx("Learning language", "學習語言")}
              <select value={language.id} onChange={(event) => changeLanguage(event.target.value)}>
                {data.languages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="field">
              {tx("Dialect context", "方言脈絡")}
              <select value={dialect} onChange={(event) => setDialect(event.target.value)}>
                {language.dialects.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
          </div>
          <dl className="learner-scope__coverage">
            <div><dt>{tx("Corpus sentences", "語料句子")}</dt><dd>{(language.counts.sentences ?? 0).toLocaleString()}</dd></div>
            <div><dt>{tx("Audio references", "音訊參照")}</dt><dd>{(language.counts.audio ?? 0).toLocaleString()}</dd></div>
            <div><dt>MT</dt><dd>{capability.mt ? tx("model", "模型") : tx("corpus only", "僅語料")}</dd></div>
            <div><dt>ASR</dt><dd>{capability.asr ? tx("model", "模型") : tx("not registered", "未登錄")}</dd></div>
            <div><dt>{tx("Orthography", "正寫法")}</dt><dd>{capability.orthography ? tx("table", "轉換表") : tx("not registered", "未登錄")}</dd></div>
          </dl>
        </section>
      )}
      <div className="privacy-banner">
        <span aria-hidden="true">●</span>
        <p>
          <strong>{t("learn.local")}</strong>
          {tx(
            " MT and ASR ask before sending anything to Hugging Face.",
            " 機器翻譯與語音辨識會在傳送資料至 Hugging Face 前取得同意。",
          )}
        </p>
      </div>
      <div className="studio-tabs" role="tablist" aria-label={tx("Learner tools", "學習工具")}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`studio-${id}`}
            onClick={() => setTab(id)}
          >
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="studio-panel" id={`studio-${tab}`} role="tabpanel">
        {tab === "lookup" && (
          <>
            <LookupKindToggle kind={lookupKind} onChange={setLookupKind} />
            <div id="lookup-results">
              <SearchTool
                key={`${lookupKind}-${languageId}`}
                data={data}
                kind={lookupKind}
                learner
                selectedLanguageId={languageId}
                onLanguageChange={changeLanguage}
                onPractice={practice}
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
            onLanguageChange={changeLanguage}
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
      <p className="learning-note">
        {tx(
          "Corpus examples link to their source. Machine output is always marked as a draft.",
          "語料例句會連結至來源；機器輸出一律標示為草稿。",
        )}
      </p>
    </div>
  );
}
