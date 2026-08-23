import {ApiRequestError} from "./apiClient";

type Translate = (english: string, traditionalChinese: string) => string;

export function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

export function apiErrorMessage(cause: unknown, tx: Translate): string {
  if (cause instanceof ApiRequestError) {
    if (cause.code === "client_timeout") {
      return tx("The request took too long. Try again or narrow the match.", "請求時間過長。請重試或縮小比對範圍。");
    }
    if (cause.code === "server_busy") {
      return tx("The service is busy. Try again.", "服務忙碌中。請重試。");
    }
    if (cause.code === "query_timed_out") {
      return tx("The query was too broad. Add a filter or narrower match.", "查詢範圍過大。請加入篩選條件或縮小比對範圍。");
    }
    if (cause.status === 429) {
      return tx("Too many requests. Wait a moment and try again.", "請求過多。請稍候再試。");
    }
  }
  return cause instanceof Error ? cause.message : String(cause);
}
