import {useCallback, useEffect, useState} from "react";

import {apiBaseUrl, checkApiRelease} from "./apiClient";
import type {
  AppData,
  ApiEnvelope,
  Corpus,
  Language,
  LearningContentCatalog,
  Meta,
  ModelCatalog,
  OrthographyCatalog,
  RightsCatalog,
} from "./types";

const base = import.meta.env.BASE_URL;

async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    headers: {Accept: "application/json"},
    ...(signal ? {signal} : {}),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return (await response.json()) as T;
}

async function apiEnvelope<T>(url: string, signal?: AbortSignal): Promise<ApiEnvelope<T>> {
  const envelope = await json<ApiEnvelope<T>>(url, signal);
  if (
    envelope.api_version !== "v1" ||
    !envelope.release_id ||
    !envelope.source?.commit ||
    !envelope.kakarayan?.commit ||
    !("data" in envelope)
  ) {
    throw new Error(`Invalid static API envelope: ${url}`);
  }
  return envelope;
}

export async function loadAppData(signal?: AbortSignal): Promise<AppData> {
  const [meta, languages, corpora, rights, models, orthography, content] = await Promise.all([
    json<Meta>(`${base}api/v1/meta.json`, signal),
    apiEnvelope<Language[]>(`${base}api/v1/languages.json`, signal),
    apiEnvelope<Corpus[]>(`${base}api/v1/corpora.json`, signal),
    apiEnvelope<RightsCatalog>(`${base}api/v1/rights.json`, signal),
    apiEnvelope<ModelCatalog>(`${base}api/v1/models.json`, signal),
    apiEnvelope<OrthographyCatalog>(`${base}api/v1/orthography.json`, signal),
    apiEnvelope<LearningContentCatalog>(`${base}api/v1/content.json`, signal),
  ]);
  if (meta.data.current_release !== meta.release_id) {
    throw new Error("Static metadata identifies two different releases");
  }
  for (const envelope of [languages, corpora, rights, models, orthography, content]) {
    if (
      envelope.release_id !== meta.release_id ||
      envelope.source.commit !== meta.source.commit ||
      envelope.kakarayan.commit !== meta.kakarayan.commit
    ) {
      throw new Error(`Static metadata release mismatch: ${envelope.endpoint}`);
    }
  }
  let query: AppData["query"];
  try {
    await checkApiRelease(meta.release_id, signal);
    query = {baseUrl: apiBaseUrl, available: true, error: ""};
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.startsWith("Release mismatch:")) throw cause;
    query = {baseUrl: apiBaseUrl, available: false, error: message};
  }
  return {
    meta,
    languages: languages.data,
    corpora: corpora.data,
    rights: rights.data,
    models: models.data,
    orthography: orthography.data,
    content: content.data,
    query,
  };
}

interface DataState {
  data: AppData | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

export function useAppData(): DataState {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<DataState, "reload">>({
    data: null,
    error: null,
    loading: true,
  });
  useEffect(() => {
    const controller = new AbortController();
    loadAppData(controller.signal).then(
      (data) => setState({data, error: null, loading: false}),
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          data: null,
          error: cause instanceof Error ? cause : new Error(String(cause)),
          loading: false,
        });
      },
    );
    return () => controller.abort();
  }, [attempt]);
  const reload = useCallback(() => {
    setState({data: null, error: null, loading: true});
    setAttempt((value) => value + 1);
  }, []);
  return {...state, reload};
}
