import type {Locale} from "./i18n";

export const DOCS_BASE_URL = "https://formosanbank.github.io/FormosanBank";

/** Paths relative to DOCS_BASE_URL. `zh` names the Traditional Chinese edition's page. */
export interface DocsPage {
  en: string;
  zh?: string;
}

export interface DocsTopic extends DocsPage {
  id: "welcome" | "languages" | "corpora" | "xml" | "terms" | "developers";
  labelEn: string;
  labelZh: string;
}

export const DOCS_TOPICS = [
  {id: "welcome", labelEn: "Overview", labelZh: "總覽", en: "", zh: "zh/"},
  {
    id: "languages",
    labelEn: "Languages",
    labelZh: "臺灣南島語",
    en: "background/formosan-languages/",
    zh: "zh/bei-jing/tai-wan-nan-dao-yu/",
  },
  {
    id: "corpora",
    labelEn: "Corpora",
    labelZh: "語料庫",
    en: "the-bank-architecture/corpora/",
    zh: "zh/yu-liao-ku-jia-gou/yu-liao-ku/",
  },
  {
    id: "xml",
    labelEn: "XML format",
    labelZh: "XML 格式",
    en: "the-bank-architecture/formosanbank-xml-format/",
    zh: "zh/yu-liao-ku-jia-gou/formosanbank-de-xml-ge-shi/",
  },
  {
    id: "terms",
    labelEn: "Terms of use",
    labelZh: "使用條款",
    en: "additional-resources/terms-of-use/",
    zh: "zh/qi-ta-zi-yuan/shi-yong-tiao-kuan/",
  },
  {
    id: "developers",
    labelEn: "Developer guide",
    labelZh: "開發者指南",
    en: "the-bank-architecture/developers/",
  },
] satisfies [DocsTopic, ...DocsTopic[]];

const corpus = (slug: string, zh?: string): DocsPage => ({
  en: `the-bank-architecture/corpora/${slug}/`,
  ...(zh && {zh: `zh/yu-liao-ku-jia-gou/yu-liao-ku/${zh}/`}),
});

export const DOCS_CORPUS_PAGES: Record<string, DocsPage> = {
  corpus_amis_pa_verbs: corpus("wu-amis-pa-verbs"),
  corpus_blust_thao_dictionary: corpus("blust-thao-dictionary"),
  corpus_campbell_favorlang: corpus("campbell-favorlang"),
  corpus_cuerq_pourrias_poinsot_amis_dictionary: corpus("cuerq-pourrias-poinsot-amis-dictionary"),
  corpus_epark: corpus("epark", "zu-yuele-yuan"),
  corpus_formosanbankgitbook: corpus("formosanbankgitbook"),
  corpus_glosbe: corpus("glosbe"),
  corpus_hundredpaiwanstories: corpus("hundredpaiwantexts"),
  corpus_huteson_rukai_survey: corpus("huteson-rukai-survey"),
  corpus_ilcaa_kanakanavu_texts: corpus("ilcaa-kanakanavu-texts"),
  corpus_ilrdf_dicts: corpus("ilrdf-dictionaries", "yuan-yu-hui-zu-yu-xian-shang-ci-dian"),
  corpus_latham_1862: corpus("latham-1862"),
  corpus_li_conjunction_thao: corpus("li-conjunction-thao"),
  corpus_montgomerytexts: corpus("montgomerytexts"),
  corpus_nowbucyang_truku_thesis: corpus("nowbucyang-truku-thesis"),
  corpus_ntu_paiwan_asr: corpus(
    "ntu-paiwan-asr",
    "guo-li-tai-wan-da-xue-pai-wan-yu-zi-dong-yu-yin-bian-shi",
  ),
  corpus_ntuformosancorpus: corpus("ntuformosancorpus"),
  corpus_paiwan_stories: corpus("paiwan-stories", "pai-wan-gu-shi"),
  corpus_presidential_apologies: corpus("presidential-apologies", "zong-tong-dao-qian-wen"),
  corpus_raudong: corpus("raudong"),
  corpus_safolu_amis_dictionary: corpus("safolu-amis-dictionary"),
  corpus_sato_pazeh_songs: corpus("sato-pazeh-songs"),
  corpus_seals33: corpus("seals33"),
  corpus_seediq_chang_reference_grammar: corpus("seediq-chang-reference-grammar"),
  corpus_siraya_gospels: corpus("siraya-gospels"),
  corpus_song_kanakanavu_grammar: corpus("song-kanakanavu-grammar"),
  corpus_tangrecordingsoftaroko: corpus("tangrecordingsoftaroko"),
  corpus_utrechtmanuscriptwordlist: corpus("utrecht-manuscript-word-list"),
  corpus_virginia_fey_dictionary: corpus("virginia-feys-amis-dictionary", "virginia-feyamei-yu-ci-dian"),
  corpus_wakelintexts: corpus("wakelintexts"),
  corpus_whitehorn_collection: corpus("whitehorn-collection"),
  corpus_wikipedias: corpus("wikipedias", "wei-ji-bai-ke"),
  corpus_wilangyutasvideos: corpus("wilangyutasvideos"),
  corpus_yeddapalemeqblog: corpus("yeddapalemeqblog"),
};

export function docsPageUrl(page: DocsPage, locale: Locale): string {
  const path = locale === "zh-Hant" && page.zh ? page.zh : page.en;
  return `${DOCS_BASE_URL}/${path}`;
}
