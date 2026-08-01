import {LazyMotion, domAnimation, useReducedMotion} from "motion/react";
import * as m from "motion/react-m";

import {useI18n} from "../i18n";
import {Link} from "../routing";
import type {AppData} from "../types";

const SIGNAL_POSITIONS = [
  [50, 8],
  [74, 15],
  [91, 37],
  [88, 66],
  [68, 87],
  [41, 92],
  [15, 75],
  [8, 47],
  [24, 21],
  [52, 22],
] as const;

function CorpusSignal({languages, label}: {languages: AppData["languages"]; label: string}) {
  const reduceMotion = useReducedMotion();
  const visibleLanguages = languages.slice(0, SIGNAL_POSITIONS.length);

  return (
    <div className="corpus-signal" aria-hidden="true">
      <svg className="corpus-signal__rings" viewBox="0 0 100 100">
        {[18, 29, 40].map((radius, index) => (
          <m.circle
            key={radius}
            cx="50"
            cy="50"
            r={radius}
            initial={reduceMotion ? false : {opacity: 0, pathLength: 0}}
            animate={{opacity: 1, pathLength: 1}}
            transition={{duration: 1.1, delay: index * 0.16, ease: "easeOut"}}
          />
        ))}
        <m.path
          d="M 9 58 C 23 35, 38 26, 52 29 S 77 49, 91 42"
          initial={reduceMotion ? false : {pathLength: 0}}
          animate={{pathLength: 1}}
          transition={{duration: 1.35, delay: 0.35, ease: "easeInOut"}}
        />
      </svg>

      <m.div
        className="corpus-signal__sweep"
        initial={reduceMotion ? false : {opacity: 0, rotate: -45}}
        animate={reduceMotion ? {opacity: 0.2, rotate: 0} : {opacity: [0, 0.3, 0.18], rotate: 315}}
        transition={
          reduceMotion
            ? {duration: 0}
            : {opacity: {duration: 1.2}, rotate: {duration: 18, repeat: Infinity, ease: "linear"}}
        }
      />

      <m.div
        className="corpus-signal__center"
        initial={reduceMotion ? false : {opacity: 0, scale: 0.82}}
        animate={{opacity: 1, scale: 1}}
        transition={{duration: 0.55, delay: 0.2}}
      >
        <strong>{languages.length}</strong>
        <span>{label}</span>
      </m.div>

      {visibleLanguages.map((language, index) => {
        const position = SIGNAL_POSITIONS[index];
        if (!position) return null;
        return (
          <span
            className={`corpus-signal__label ${index > 6 ? "corpus-signal__label--secondary" : ""}`}
            key={language.id}
            style={{left: `${position[0]}%`, top: `${position[1]}%`}}
          >
            <m.span
              initial={reduceMotion ? false : {opacity: 0, y: 7}}
              animate={
                reduceMotion
                  ? {opacity: 1, y: 0}
                  : {opacity: 1, y: index % 2 === 0 ? [0, -3, 0] : [0, 3, 0]}
              }
              transition={
                reduceMotion
                  ? {duration: 0}
                  : {
                      opacity: {duration: 0.4, delay: 0.45 + index * 0.06},
                      y: {duration: 4.5 + index * 0.18, delay: 1, repeat: Infinity, ease: "easeInOut"},
                    }
              }
            >
              {language.name}
            </m.span>
          </span>
        );
      })}
    </div>
  );
}

export function Home({data}: {data: AppData}) {
  const {number, t, tx} = useI18n();
  const reduceMotion = useReducedMotion();
  const counts = data.corpora.reduce(
    (total, corpus) => {
      total.sentences += corpus.counts.sentences ?? 0;
      total.tokens += corpus.counts.tokens ?? 0;
      total.audio += corpus.counts.audio ?? 0;
      return total;
    },
    {sentences: 0, tokens: 0, audio: 0},
  );
  const stats = [
    [data.languages.length, tx("Languages", "語言")],
    [data.corpora.length, tx("Corpora", "語料庫")],
    [counts.sentences, tx("Sentences", "句子")],
    [counts.tokens, tx("Tokens", "詞元")],
    [counts.audio, tx("Audio references", "音訊參照")],
  ] as const;
  const audiences = [
    {
      title: tx("For learners", "給學習者"),
      description: tx(
        "Save a dictionary entry or sentence, then review it in your private local deck.",
        "儲存單詞或例句後，在私人本機字卡中複習。",
      ),
      link: "/learn",
      action: tx("Open learning tools", "開啟學習工具"),
      tone: "coral",
    },
    {
      title: tx("For linguists", "給語言學家"),
      description: tx(
        "Filter corpus records and export reproducible research datasets.",
        "篩選語料記錄並匯出可重現的研究資料集。",
      ),
      link: "/research",
      action: tx("Open research tools", "開啟研究工具"),
      tone: "gold",
    },
    {
      title: tx("For developers", "給開發者"),
      description: tx(
        "Use versioned static APIs and JavaScript, Python, or R clients.",
        "使用具版本的靜態 API 與 JavaScript、Python 或 R 用戶端。",
      ),
      link: "/developers",
      action: tx("Read API docs", "查看 API 文件"),
      tone: "moss",
    },
  ] as const;
  const tools = [
    ["/lookup", tx("Corpus lookup", "語料查詢"), tx("dictionary + sentences", "單詞釋義與語境例句")],
    ["/learn", tx("Learning tools", "學習工具"), tx("deck, MT, and ASR", "字卡、翻譯與語音")],
    ["/research", tx("Research", "研究工具"), tx("datasets and summaries", "資料集與摘要")],
    ["/downloads", tx("Downloads", "資料下載"), tx("prepared formats", "準備好的格式")],
    ["/developers", tx("API and clients", "API 與用戶端"), tx("build with the bank", "使用語料庫開發")],
  ] as const;

  return (
    <LazyMotion features={domAnimation} strict>
      <section className="home-hero">
        <m.div
          className="home-hero__copy"
          initial={reduceMotion ? false : {opacity: 0, y: 18}}
          animate={{opacity: 1, y: 0}}
          transition={{duration: 0.65, ease: "easeOut"}}
        >
          <p className="eyebrow">{t("home.eyebrow")}</p>
          <h1>{t("home.title")}</h1>
          <p className="home-hero__lede">{t("home.lede")}</p>
          <nav className="home-hero__actions" aria-label={tx("Start here", "從這裡開始")}>
            <Link className="button button--primary" to="/lookup">
              {tx("Open corpus lookup", "開啟語料查詢")}
            </Link>
            <Link className="button button--paper" to="/explore">
              {tx("Browse languages", "瀏覽語言")}
            </Link>
            <Link className="home-hero__text-link" to="/downloads">
              {tx("Download data", "下載資料")} <span aria-hidden="true">↗</span>
            </Link>
          </nav>
          <p className="home-hero__release">
            <span>{tx("Current release", "目前版本")}</span>
            <code>{data.meta.release_id}</code>
          </p>
        </m.div>
        <CorpusSignal languages={data.languages} label={tx("languages", "種語言")} />
      </section>

      <section className="home-stats" aria-labelledby="home-stats-title">
        <div className="home-section-heading">
          <p className="eyebrow">{tx("THE PROJECT", "專案概況")}</p>
          <h2 id="home-stats-title">{tx("FormosanBank at a glance", "FormosanBank 一覽")}</h2>
        </div>
        <div className="home-stats__grid">
          {stats.map(([value, label]) => (
            <div className="home-stat" key={label}>
              <strong>{number(value)}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="home-audiences" aria-labelledby="home-audiences-title">
        <div className="home-section-heading home-section-heading--split">
          <div>
            <p className="eyebrow">{tx("CHOOSE YOUR ROUTE", "選擇入口")}</p>
            <h2 id="home-audiences-title">{tx("One corpus bank, three ways in.", "同一座語料庫，三種使用方式。")}</h2>
          </div>
          <p>{tx("Everything starts with public, cited corpus data.", "所有工具都以公開且可引用的語料為基礎。")}</p>
        </div>
        <div className="home-audience-grid">
          {audiences.map((audience) => (
            <article
              className={`home-audience-card home-audience-card--${audience.tone}`}
              key={audience.link}
            >
              <span className="home-audience-card__mark" aria-hidden="true" />
              <h3>{audience.title}</h3>
              <p>{audience.description}</p>
              <Link to={audience.link}>
                {audience.action} <span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </div>
      </section>

      <nav className="home-tools" aria-labelledby="home-tools-title">
        <div className="home-section-heading">
          <p className="eyebrow">{tx("ALL TOOLS", "全部工具")}</p>
          <h2 id="home-tools-title">{tx("Go straight to the work.", "直接開始使用。")}</h2>
        </div>
        <div className="home-tools__grid">
          {tools.map(([to, label, description]) => (
            <Link key={to} to={to}>
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              <span aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
      </nav>
    </LazyMotion>
  );
}
