import {PageIntro, Stat} from "../components/Layout";
import {useI18n} from "../i18n";
import {Link} from "../routing";
import type {AppData} from "../types";

export function Home({data}: {data: AppData}) {
  const {t, tx} = useI18n();
  const counts = data.corpora.reduce(
    (total, corpus) => {
      total.sentences += corpus.counts.sentences ?? 0;
      total.tokens += corpus.counts.tokens ?? 0;
      total.audio += corpus.counts.audio ?? 0;
      return total;
    },
    {sentences: 0, tokens: 0, audio: 0},
  );
  return (
    <>
      <section className="hero">
        <div className="hero__copy">
          <PageIntro
            eyebrow={t("home.eyebrow")}
            title={t("home.title")}
            lede={t("home.lede")}
          />
          <div className="hero__actions">
            <Link className="button button--primary" to="/search">
              {t("home.search")}
            </Link>
            <Link className="button button--paper" to="/learn">
              {t("home.learn")}
            </Link>
          </div>
          <p className="privacy-line">
            <span aria-hidden="true">◉</span>{" "}
            {tx(
              "Corpus search runs locally. Study progress stays on this device.",
              "語料搜尋在本機執行，學習進度只保存在此裝置。",
            )}
          </p>
        </div>
        <div
          className="hero__field-card"
          aria-label={tx("Kakarayan principles", "Kakarayan 原則")}
        >
          <span className="field-card__number">01</span>
          <p className="field-card__script">kakarayan</p>
          <h2>{tx("Source before certainty", "先看來源，再下定論")}</h2>
          <p>
            {tx(
              "Every attestation keeps its corpus, dialect, XML path, orthography label, citation, and rights context.",
              "每筆例證都保留語料庫、方言、XML 路徑、書寫標籤、引用與權利脈絡。",
            )}
          </p>
          <div className="field-card__rule" />
          <small>
            {tx("FormosanBank public release", "FormosanBank 公開資料版本")} ·{" "}
            {data.meta.release_id}
          </small>
        </div>
      </section>

      <section className="collection-band">
        <div className="section-heading">
          <p className="eyebrow">{t("home.collection")}</p>
          <h2>{tx("One bank, many kinds of evidence", "一座語料庫，多種語言證據")}</h2>
        </div>
        <div className="stats-grid">
          <Stat
            value={data.languages.length}
            label={tx("display languages", "顯示語言")}
            tone="ink"
          />
          <Stat
            value={data.corpora.length}
            label={tx("public corpora", "公開語料庫")}
            tone="coral"
          />
          <Stat value={counts.sentences} label={tx("sentences", "句子")} tone="gold" />
          <Stat
            value={counts.tokens}
            label={tx("searchable tokens", "可搜尋詞元")}
            tone="moss"
          />
        </div>
      </section>

      <section className="pathways">
        <article className="pathway pathway--learn">
          <span className="pathway__index">A</span>
          <p className="eyebrow">{tx("For learners and families", "給學習者與家庭")}</p>
          <h2>{tx("Find a word. Hear the source. Make it yours.", "查詞、聽原音，化為自己的語言。")}</h2>
          <p>
            {tx(
              "Begin with Amis examples, save local cards, record yourself, and use optional MT or ASR with clear third-party disclosure.",
              "從阿美語例句開始，儲存本機字卡、錄下自己的聲音，並在清楚揭露第三方服務後選用機器翻譯或語音辨識。",
            )}
          </p>
          <Link to="/learn">{tx("Open the learner studio →", "開啟學習工作室 →")}</Link>
        </article>
        <article className="pathway pathway--research">
          <span className="pathway__index">B</span>
          <p className="eyebrow">{tx("For linguists", "給語言學家")}</p>
          <h2>{tx("Move from concordance to reproducible dataset.", "從索引行走向可重現資料集。")}</h2>
          <p>
            {tx(
              "Search source and standardized forms, preserve tier order, inspect rights, and download normalized or canonical representations.",
              "搜尋來源與標準化形式、保留層級順序、查閱權利資訊，並下載正規化或標準來源格式。",
            )}
          </p>
          <Link to="/explore">{tx("Explore research data →", "探索研究資料 →")}</Link>
        </article>
        <article className="pathway pathway--build">
          <span className="pathway__index">C</span>
          <p className="eyebrow">{tx("For builders", "給開發者")}</p>
          <h2>{tx("Start static. Add the live API only when useful.", "先用靜態資料，必要時再加即時 API。")}</h2>
          <p>
            {tx(
              "Versioned JSON, checksums, schemas, model metadata, and thin clients keep integrations public and reproducible.",
              "具版本的 JSON、校驗碼、結構描述、模型中繼資料與輕量用戶端，讓整合維持公開且可重現。",
            )}
          </p>
          <Link to="/developers">{tx("Read developer access →", "查看開發者存取方式 →")}</Link>
        </article>
      </section>
    </>
  );
}
