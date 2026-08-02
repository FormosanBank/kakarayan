import {useI18n} from "../i18n";
import {Link} from "../routing";
import type {AppData} from "../types";

export function Home({data}: {data: AppData}) {
  const {number, t, tx} = useI18n();
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
    },
    {
      title: tx("For linguists", "給語言學家"),
      description: tx(
        "Filter corpus records and export reproducible research datasets.",
        "篩選語料記錄並匯出可重現的研究資料集。",
      ),
      link: "/research",
      action: tx("Open research tools", "開啟研究工具"),
    },
    {
      title: tx("For developers", "給開發者"),
      description: tx(
        "Use versioned static APIs and JavaScript, Python, or R clients.",
        "使用具版本的靜態 API 與 JavaScript、Python 或 R 用戶端。",
      ),
      link: "/developers",
      action: tx("Read API docs", "查看 API 文件"),
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
    <div className="home-page">
      <section className="home-hero">
        <div className="home-hero__mark" aria-hidden="true">K</div>
        <h1>{t("home.title")}</h1>
        <p className="home-hero__lede">{t("home.lede")}</p>
        <div className="home-hero__release">
          <code>
            {number(data.languages.length)} {tx("languages", "種語言")} · {number(counts.sentences)} {tx("sentences", "句子")}
          </code>
        </div>
        <Link className="button button--primary" to="/lookup">
          {tx("Open lookup", "開啟查詢")}
        </Link>
      </section>

      <section className="home-audiences" aria-labelledby="home-audiences-title">
        <h2 id="home-audiences-title" className="sr-only">{tx("Choose a tool", "選擇工具")}</h2>
        <div className="home-audience-grid">
          {audiences.map((audience) => (
            <article className="home-audience-card" key={audience.link}>
              <div>
              <h3>{audience.title}</h3>
              <p>{audience.description}</p>
              </div>
              <Link className="button button--quiet" to={audience.link}>{audience.action}</Link>
            </article>
          ))}
        </div>
      </section>

      <section className="home-stats" aria-labelledby="home-stats-title">
        <div className="home-section-heading">
          <h2 id="home-stats-title">{tx("Corpus snapshot", "語料概況")}</h2>
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

      <nav className="home-tools" aria-labelledby="home-tools-title">
        <div className="home-section-heading">
          <h2 id="home-tools-title">{tx("All tools", "全部工具")}</h2>
        </div>
        <div className="home-tools__grid">
          {tools.map(([to, label, description]) => (
            <Link key={to} to={to}>
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
