import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

export type Locale = "en" | "zh-Hant";

const messages = {
  en: {
    "nav.dictionary": "Dictionary",
    "nav.sentences": "Sentences",
    "nav.learn": "Learn",
    "nav.research": "Research",
    "nav.explore": "Explore",
    "nav.download": "Download",
    "nav.developers": "Developers",
    "nav.models": "Models",
    "nav.about": "About",
    "nav.skip": "Skip to content",
    "footer.summary": "Search, study, and download the public FormosanBank corpora.",
    "common.loading": "Loading public release…",
    "common.unavailable": "Public release data is unavailable.",
    "common.retry": "Try again",
    "common.release": "Data release",
    "common.source": "Source commit",
    "home.eyebrow": "PUBLIC FORMOSAN LANGUAGE DATA",
    "home.title": "FormosanBank, ready to use.",
    "home.lede": "Search, study, download, or build.",
    "explore.title": "Explore the bank",
    "explore.lede": "Browse languages, corpora, counts, source links, and usage terms.",
    "search.title": "Sentence search",
    "search.lede":
      "Find sentences containing a word, phrase, translation, or linguistic tier.",
    "search.query": "Word or meaning",
    "search.language": "Language",
    "search.corpus": "Corpus",
    "search.mode": "Match",
    "search.source": "Source exact",
    "search.exact": "Normalized exact",
    "search.prefix": "Prefix",
    "search.contains": "Contains",
    "search.translation": "Translation",
    "search.phonology": "Phonology",
    "search.gloss": "Morpheme or gloss",
    "search.fuzzy": "Fuzzy",
    "search.regex": "Scoped RE2",
    "search.submit": "Search",
    "search.scope": "Choose a language before loading corpus shards.",
    "search.noResults": "No matching public attestations in this scope.",
    "search.results": "attestations",
    "search.original": "Source orthography",
    "search.standard": "FormosanBank standard",
    "search.save": "Save to deck",
    "search.research": "Research view",
    "learn.title": "Learn from corpus examples",
    "learn.lede":
      "Save words or sentences, review them here, and try optional MT or ASR.",
    "learn.lookup": "Dictionary and examples",
    "learn.deck": "Study deck",
    "learn.practice": "Pronunciation",
    "learn.translate": "Machine translation",
    "learn.orthography": "Orthography",
    "learn.local": "Your decks and recordings stay on this device.",
    "deck.empty": "Save a word or sentence to start your deck.",
    "deck.due": "due now",
    "deck.export": "Export backup",
    "deck.import": "Restore backup",
    "deck.review": "Review due cards",
    "download.title": "Download public data",
    "download.lede":
      "Choose a research format with provenance, checksums, citations, and corpus-specific rights.",
    "developers.title": "Build with FormosanBank",
    "developers.lede":
      "Use the versioned static JSON API or the optional live API.",
    "models.title": "Public language models",
    "models.lede":
      "Check FormosanBank MT and ASR models, licenses, limits, and service status.",
    "about.title": "About Kakarayan",
    "about.lede":
      "Kakarayan is the public search, learning, download, and API interface for FormosanBank.",
  },
  "zh-Hant": {
    "nav.dictionary": "單詞",
    "nav.sentences": "例句",
    "nav.learn": "學習",
    "nav.research": "研究",
    "nav.explore": "探索",
    "nav.download": "下載",
    "nav.developers": "開發者",
    "nav.models": "模型",
    "nav.about": "關於",
    "nav.skip": "跳至主要內容",
    "footer.summary": "搜尋、學習並下載公開 FormosanBank 語料庫。",
    "common.loading": "正在載入公開資料版本…",
    "common.unavailable": "目前無法取得公開資料版本。",
    "common.retry": "再試一次",
    "common.release": "資料版本",
    "common.source": "來源提交",
    "home.eyebrow": "公開臺灣南島語資料",
    "home.title": "FormosanBank，開箱即用。",
    "home.lede": "查詢、學習、下載或開發。",
    "explore.title": "探索語料庫",
    "explore.lede": "瀏覽語言、語料庫、數量、來源連結與使用條款。",
    "search.title": "例句搜尋",
    "search.lede": "尋找包含單詞、片語、翻譯或語言層級的句子。",
    "search.query": "詞語或翻譯",
    "search.language": "語言",
    "search.corpus": "語料庫",
    "search.mode": "比對方式",
    "search.source": "來源字串完全相符",
    "search.exact": "正規化後完全相符",
    "search.prefix": "詞首",
    "search.contains": "包含",
    "search.translation": "翻譯",
    "search.phonology": "音韻形式",
    "search.gloss": "語素或詞彙註解",
    "search.fuzzy": "近似搜尋",
    "search.regex": "限定範圍 RE2",
    "search.submit": "搜尋",
    "search.scope": "請先選擇語言，再載入對應的語料分片。",
    "search.noResults": "此範圍內沒有相符的公開例證。",
    "search.results": "筆例證",
    "search.original": "來源書寫",
    "search.standard": "FormosanBank 標準",
    "search.save": "儲存到字卡",
    "search.research": "研究檢視",
    "learn.title": "從語料例句學習",
    "learn.lede": "儲存單詞或例句、在此複習，並選用機器翻譯或語音辨識。",
    "learn.lookup": "詞典與例句",
    "learn.deck": "學習字卡",
    "learn.practice": "發音練習",
    "learn.translate": "機器翻譯",
    "learn.orthography": "書寫系統",
    "learn.local": "您的字卡與錄音只保存在此裝置。",
    "deck.empty": "儲存單詞或例句即可開始建立字卡。",
    "deck.due": "現在到期",
    "deck.export": "匯出備份",
    "deck.import": "還原備份",
    "deck.review": "複習到期字卡",
    "download.title": "下載公開資料",
    "download.lede": "選擇研究格式，並保留來源、校驗碼、引用與各語料庫權利資訊。",
    "developers.title": "使用 FormosanBank 開發",
    "developers.lede": "使用具版本的靜態 JSON API 或選用的即時 API。",
    "models.title": "公開語言模型",
    "models.lede": "查看 FormosanBank 機器翻譯與語音辨識模型、授權、限制及服務狀態。",
    "about.title": "關於 Kakarayan",
    "about.lede": "Kakarayan 是 FormosanBank 的公開搜尋、學習、下載與 API 介面。",
  },
} as const;

type MessageKey = keyof (typeof messages)["en"];

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
  tx: (english: string, traditionalChinese: string) => string;
  number: (value: number) => string;
  date: (value: string | Date) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function initialLocale(): Locale {
  const stored = window.localStorage.getItem("kakarayan-locale");
  if (stored === "zh-Hant" || stored === "en") return stored;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-Hant" : "en";
}

export function I18nProvider({children}: PropsWithChildren) {
  const [locale, updateLocale] = useState<Locale>(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    window.localStorage.setItem("kakarayan-locale", next);
    updateLocale(next);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key) => messages[locale][key],
      tx: (english, traditionalChinese) =>
        locale === "zh-Hant" ? traditionalChinese : english,
      number: (input) => new Intl.NumberFormat(locale).format(input),
      date: (input) =>
        new Intl.DateTimeFormat(locale, {dateStyle: "medium"}).format(new Date(input)),
    }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within I18nProvider");
  return value;
}
