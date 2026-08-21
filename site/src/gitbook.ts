import type {Locale} from "./i18n";

export const GITBOOK_BASE_URL = "https://ai4commsci.gitbook.io/formosanbank";

export interface GitBookPage {
  en: string;
  zh?: string;
}

export interface GitBookTopic extends GitBookPage {
  id: "welcome" | "languages" | "corpora" | "xml" | "terms" | "developers";
  labelEn: string;
  labelZh: string;
}

export const GITBOOK_TOPICS = [
  {
    id: "welcome",
    labelEn: "Overview",
    labelZh: "總覽",
    en: "",
  },
  {
    id: "languages",
    labelEn: "Languages",
    labelZh: "臺灣南島語",
    en: "background/formosan-languages",
  },
  {
    id: "corpora",
    labelEn: "Corpora",
    labelZh: "語料庫",
    en: "the-bank-architecture/corpora",
  },
  {
    id: "xml",
    labelEn: "XML format",
    labelZh: "XML 格式",
    en: "the-bank-architecture/formosanbank-xml-format",
  },
  {
    id: "terms",
    labelEn: "Terms of use",
    labelZh: "使用條款",
    en: "additional-resources/terms-of-use",
  },
  {
    id: "developers",
    labelEn: "Developer guide",
    labelZh: "開發者指南",
    en: "the-bank-architecture/developers",
  },
] satisfies [GitBookTopic, ...GitBookTopic[]];

export const GITBOOK_CORPUS_PAGES: Record<string, GitBookPage> = {
  corpus_epark: {
    en: "the-bank-architecture/corpora/epark",
  },
  corpus_formosanbankgitbook: {en: "the-bank-architecture/corpora/formosanbankgitbook"},
  corpus_glosbe: {en: "the-bank-architecture/corpora/glosbe"},
  corpus_hundredpaiwanstories: {en: "the-bank-architecture/corpora/hundredpaiwantexts"},
  corpus_ilrdf_dicts: {
    en: "the-bank-architecture/corpora/ilrdf-dictionaries",
  },
  corpus_montgomerytexts: {en: "the-bank-architecture/corpora/montgomerytexts"},
  corpus_nowbucyang_truku_thesis: {en: "the-bank-architecture/corpora/nowbucyang-truku-thesis"},
  corpus_ntu_paiwan_asr: {
    en: "the-bank-architecture/corpora/ntu-paiwan-asr",
  },
  corpus_ntuformosancorpus: {en: "the-bank-architecture/corpora/ntuformosancorpus"},
  corpus_paiwan_stories: {
    en: "the-bank-architecture/corpora/paiwan-stories",
  },
  corpus_presidential_apologies: {
    en: "the-bank-architecture/corpora/presidential-apologies",
  },
  corpus_raudong: {en: "the-bank-architecture/corpora/raudong"},
  corpus_safolu_amis_dictionary: {en: "the-bank-architecture/corpora/safolu-amis-dictionary"},
  corpus_seals33: {en: "the-bank-architecture/corpora/seals33"},
  corpus_siraya_gospels: {en: "the-bank-architecture/corpora/siraya-gospels"},
  corpus_tangrecordingsoftaroko: {en: "the-bank-architecture/corpora/tangrecordingsoftaroko"},
  corpus_virginia_fey_dictionary: {
    en: "the-bank-architecture/corpora/virginia-feys-amis-dictionary",
  },
  corpus_wakelintexts: {en: "the-bank-architecture/corpora/wakelintexts"},
  corpus_whitehorn_collection: {en: "the-bank-architecture/corpora/whitehorn-collection"},
  corpus_wikipedias: {
    en: "the-bank-architecture/corpora/wikipedias",
  },
  corpus_wilangyutasvideos: {en: "the-bank-architecture/corpora/wilangyutasvideos"},
  corpus_yeddapalemeqblog: {en: "the-bank-architecture/corpora/yeddapalemeqblog"},
};

export function gitBookPagePath(page: GitBookPage, locale: Locale): string {
  return locale === "zh-Hant" && page.zh ? page.zh : page.en;
}

export function gitBookPageUrl(page: GitBookPage, locale: Locale): string {
  const path = gitBookPagePath(page, locale);
  return path ? `${GITBOOK_BASE_URL}/${path}` : GITBOOK_BASE_URL;
}
