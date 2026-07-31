import {useState} from "react";

import {PageIntro} from "../components/Layout";
import {TranslationTool} from "../components/ModelTools";
import {OrthographyTool} from "../components/OrthographyTool";
import {Recorder} from "../components/Recorder";
import {SearchTool} from "../components/SearchTool";
import {StudyDeck} from "../components/StudyDeck";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

type StudioTab = "lookup" | "deck" | "practice" | "translation" | "orthography";

export function Learn({data}: {data: AppData}) {
  const {t} = useI18n();
  const [tab, setTab] = useState<StudioTab>("lookup");
  const tabs: Array<[StudioTab, string, string]> = [
    ["lookup", t("learn.lookup"), "Find cited words and examples"],
    ["deck", t("learn.deck"), "Review private local cards"],
    ["practice", t("learn.practice"), "Record locally, transcribe optionally"],
    ["translation", t("learn.translate"), "Send text only with consent"],
    ["orthography", t("learn.orthography"), "Apply reviewed conversion tables"],
  ];
  return (
    <div className="page-wrap page-wrap--wide learner-page">
      <PageIntro title={t("learn.title")} lede={t("learn.lede")} />
      <div className="privacy-banner">
        <span aria-hidden="true">◎</span>
        <p>
          <strong>{t("learn.local")}</strong>
          Optional model actions name the public third party before anything leaves the
          browser.
        </p>
      </div>
      <div className="studio-tabs" role="tablist" aria-label="Learner tools">
        {tabs.map(([id, label, detail]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`studio-${id}`}
            onClick={() => setTab(id)}
          >
            <span>{label}</span>
            <small>{detail}</small>
          </button>
        ))}
      </div>
      <div className="studio-panel" id={`studio-${tab}`} role="tabpanel">
        {tab === "lookup" && <SearchTool data={data} learner />}
        {tab === "deck" && <StudyDeck />}
        {tab === "practice" && <Recorder catalog={data.models} />}
        {tab === "translation" && <TranslationTool catalog={data.models} />}
        {tab === "orthography" && (
          <OrthographyTool
            catalog={data.orthography}
            sourceCommit={data.meta.source.commit}
          />
        )}
      </div>
      <aside className="learning-boundary">
        <p className="eyebrow">What Kakarayan is claiming</p>
        <ul>
          <li>Corpus examples are attestations from the named source, not universal rules.</li>
          <li>FormosanBank standard orthography is distinct from source orthography.</li>
          <li>Machine translation and ASR can be useful drafts and can also be wrong.</li>
          <li>Reviewed lessons will name their author, reviewer, source, date, and rights.</li>
        </ul>
      </aside>
    </div>
  );
}
