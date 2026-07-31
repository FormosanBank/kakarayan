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
    "nav.learn": "Learn",
    "nav.explore": "Explore",
    "nav.download": "Download",
    "nav.developers": "Developers",
    "nav.models": "Models",
    "nav.about": "About",
    "common.loading": "Loading public release…",
    "common.unavailable": "Public release data is unavailable.",
    "common.retry": "Try again",
    "common.release": "Data release",
    "common.source": "Source commit",
    "home.eyebrow": "A public field station for Formosan languages",
    "home.title": "Listen closely. Search deeply. Carry the language forward.",
    "home.lede":
      "Kakarayan opens FormosanBank for community learners, linguists, educators, and builders. Research and study tools run in your browser.",
    "home.search": "Search the corpus",
    "home.learn": "Start with Amis",
    "home.collection": "Collection at a glance",
    "explore.title": "Explore the bank",
    "explore.lede": "Browse distinct languages and source corpora without flattening dialect or rights.",
    "search.title": "Corpus search",
    "search.lede":
      "Search public attestations. Original and standardized orthography remain separately labeled.",
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
    "learn.title": "Amis learning studio",
    "learn.lede":
      "Build from cited examples, keep your study data on this device, and treat machine output as a draft.",
    "learn.lookup": "Dictionary and examples",
    "learn.deck": "Study deck",
    "learn.practice": "Pronunciation",
    "learn.translate": "Machine translation",
    "learn.orthography": "Orthography",
    "learn.local": "Your decks and recordings stay on this device.",
    "deck.empty": "Save a corpus example to begin a local deck.",
    "deck.due": "due now",
    "deck.export": "Export backup",
    "deck.import": "Restore backup",
    "deck.review": "Review due cards",
    "download.title": "Download public data",
    "download.lede":
      "Choose a research format with provenance, checksums, citations, and corpus-specific rights.",
    "developers.title": "Build with FormosanBank",
    "developers.lede":
      "Use immutable static JSON today. The live API is an optional convenience, never the only route to the data.",
    "models.title": "Public language models",
    "models.lede":
      "Browse FormosanBank MT and ASR resources with their licenses, provenance, limits, and service state.",
    "about.title": "About Kakarayan",
    "about.lede":
      "Kakarayan is the public interface to FormosanBank. The XML remains canonical; every table and index here is derived.",
  },
  "zh-Hant": {
    "nav.learn": "學習",
    "nav.explore": "探索",
    "nav.download": "下載",
    "nav.developers": "開發者",
    "nav.models": "模型",
    "nav.about": "關於",
    "common.loading": "正在載入公開資料版本…",
    "common.unavailable": "目前無法取得公開資料版本。",
    "common.retry": "再試一次",
    "common.release": "資料版本",
    "common.source": "來源提交",
    "home.eyebrow": "臺灣南島語的公共田野工作站",
    "home.title": "仔細聆聽，深入搜尋，讓語言繼續流傳。",
    "home.lede":
      "Kakarayan 讓族人、學習者、語言學家、教師與開發者都能使用 FormosanBank。研究與學習工具在您的瀏覽器中運作。",
    "home.search": "搜尋語料庫",
    "home.learn": "從阿美語開始",
    "home.collection": "典藏概覽",
    "explore.title": "探索語料庫",
    "explore.lede": "瀏覽不同語言與來源語料庫，同時保留方言與權利資訊。",
    "search.title": "語料搜尋",
    "search.lede": "搜尋公開例證。原始書寫與 FormosanBank 標準書寫會分開標示。",
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
    "learn.title": "阿美語學習工作室",
    "learn.lede": "從有來源的例句學習，把進度留在本機，並將機器輸出視為草稿。",
    "learn.lookup": "詞典與例句",
    "learn.deck": "學習字卡",
    "learn.practice": "發音練習",
    "learn.translate": "機器翻譯",
    "learn.orthography": "書寫系統",
    "learn.local": "您的字卡與錄音只保存在此裝置。",
    "deck.empty": "先儲存一筆語料例句，即可建立本機字卡。",
    "deck.due": "現在到期",
    "deck.export": "匯出備份",
    "deck.import": "還原備份",
    "deck.review": "複習到期字卡",
    "download.title": "下載公開資料",
    "download.lede": "選擇研究格式，並保留來源、校驗碼、引用與各語料庫權利資訊。",
    "developers.title": "使用 FormosanBank 開發",
    "developers.lede": "立即使用不可變的靜態 JSON。即時 API 只是額外便利，不是唯一資料管道。",
    "models.title": "公開語言模型",
    "models.lede": "查看 FormosanBank 的機器翻譯與語音辨識資源、授權、來源、限制及服務狀態。",
    "about.title": "關於 Kakarayan",
    "about.lede": "Kakarayan 是 FormosanBank 的公開介面。XML 是標準來源，這裡的表格與索引皆為衍生資料。",
  },
} as const;

type MessageKey = keyof (typeof messages)["en"];

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
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
    () => ({locale, setLocale, t: (key) => messages[locale][key]}),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within I18nProvider");
  return value;
}
