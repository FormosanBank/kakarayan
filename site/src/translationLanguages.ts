import type {Locale} from "./i18n";

const names: Record<string, [string, string]> = {
  cmn: ["Mandarin Chinese", "華語"],
  deu: ["German", "德文"],
  eng: ["English", "英文"],
  fra: ["French", "法文"],
  ita: ["Italian", "義大利文"],
  jpn: ["Japanese", "日文"],
  kor: ["Korean", "韓文"],
  nld: ["Dutch", "荷蘭文"],
  por: ["Portuguese", "葡萄牙文"],
  spa: ["Spanish", "西班牙文"],
  zho: ["Chinese", "中文"],
};

export function translationLanguageName(xmlLang: string, locale: Locale): string {
  const values = names[xmlLang.toLocaleLowerCase()];
  return values?.[locale === "zh-Hant" ? 1 : 0] ?? xmlLang.toLocaleUpperCase();
}
