import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import {messages, type MessageKey} from "./i18nMessages";
import type {Language} from "./types";

export type Locale = "en" | "zh-Hant";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
  tx: (english: string, traditionalChinese: string) => string;
  number: (value: number) => string;
  date: (value: string | Date) => string;
  languageName: (language: Pick<Language, "name" | "names">) => string;
  dialectName: (dialect: string) => string;
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
      languageName: (language) => {
        if (locale === "en") return language.name;
        const local = language.names["zh-Hant"];
        return local && local !== language.name ? `${local} · ${language.name}` : language.name;
      },
      dialectName: (dialect) =>
        locale === "zh-Hant" && dialect.toLocaleLowerCase() === "unknown" ? "未知" : dialect,
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
