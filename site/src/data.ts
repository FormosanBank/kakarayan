import {createContext, useCallback, useEffect, useState, type Dispatch, type SetStateAction} from "react";

import {apiBaseUrl, checkApiRelease} from "./apiClient";
import type {AppData, ApiEnvelope, Corpus, Language, Meta, OptionalResource, RightsCatalog} from "./types";

const base = import.meta.env.BASE_URL;
export const ResourceRetryContext = createContext<(resource: OptionalResource) => void>(() => {
  throw new Error("Resource retry is not available outside the application");
});

async function json<T>(url: string, signal?: AbortSignal, timeoutMs = 8_000): Promise<T> {
  const controller = new AbortController();
  let rejectAbort: (reason: unknown) => void = () => undefined;
  const interrupted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const cancel = () => {
    const reason = signal?.reason ?? new DOMException("Request cancelled", "AbortError");
    controller.abort(reason);
    rejectAbort(reason);
  };
  const timer = window.setTimeout(() => {
    const error = new Error("Static data did not respond in time");
    controller.abort(error);
    rejectAbort(error);
  }, timeoutMs);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, {once: true});
  try {
    return await Promise.race([(async () => {
      const response = await fetch(url, {headers: {Accept: "application/json"}, signal: controller.signal});
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
      return await response.json() as T;
    })(), interrupted]);
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

async function apiEnvelope<T>(url: string, signal?: AbortSignal, timeoutMs?: number): Promise<ApiEnvelope<T>> {
  const envelope = await json<ApiEnvelope<T>>(url, signal, timeoutMs);
  if (!envelope || typeof envelope !== "object" || envelope.api_version !== "v1" ||
    !envelope.release_id || !envelope.source?.commit || !envelope.kakarayan?.commit || !("data" in envelope)) {
    throw new Error(`Invalid static API envelope: ${url}`);
  }
  return envelope;
}

function sameRelease(meta: Meta, envelope: ApiEnvelope<unknown>) {
  if (envelope.release_id !== meta.release_id || envelope.source.commit !== meta.source.commit ||
    envelope.kakarayan.commit !== meta.kakarayan.commit) {
    throw new Error(`Static metadata release mismatch: ${envelope.endpoint}`);
  }
}

export async function loadAppData(signal?: AbortSignal): Promise<AppData> {
  const [meta, languages, corpora, rights] = await Promise.all([
    apiEnvelope<Meta["data"]>(`${base}api/v1/meta.json`, signal),
    apiEnvelope<Language[]>(`${base}api/v1/languages.json`, signal),
    apiEnvelope<Corpus[]>(`${base}api/v1/corpora.json`, signal),
    apiEnvelope<RightsCatalog>(`${base}api/v1/rights.json`, signal),
  ]);
  if (meta.endpoint !== "meta" || meta.data.current_release !== meta.release_id) {
    throw new Error("Static metadata identifies two different releases");
  }
  const identity: Meta = {...meta, endpoint: "meta"};
  for (const envelope of [languages, corpora, rights]) sameRelease(identity, envelope);
  return {
    meta: identity, languages: languages.data, corpora: corpora.data, rights: rights.data,
    models: {schema_version: meta.schema_version, generated_at: meta.generated_at, provider: "Hugging Face", models: [], services: []},
    orthography: {schema_version: meta.schema_version, source_commit: meta.source.commit, tables: []},
    content: {schema_version: meta.schema_version, entries: []},
    resources: {
      models: {status: "loading", error: ""}, orthography: {status: "loading", error: ""},
      content: {status: "loading", error: ""},
    },
    query: {baseUrl: apiBaseUrl, available: false, error: ""},
  };
}

export async function loadOptionalCatalog<K extends OptionalResource>(
  resource: K, meta: Meta, signal?: AbortSignal, timeoutMs?: number,
): Promise<AppData[K]> {
  const envelope = await apiEnvelope<AppData[K]>(`${base}api/v1/${resource}.json`, signal, timeoutMs);
  sameRelease(meta, envelope);
  return envelope.data;
}

interface DataState {
  data: AppData | null;
  error: Error | null;
  loading: boolean;
}
type SetDataState = Dispatch<SetStateAction<DataState>>;

function useOptionalCatalog(resource: OptionalResource, meta: Meta | undefined, attempt: number, setState: SetDataState) {
  useEffect(() => {
    if (!meta) return;
    const controller = new AbortController();
    loadOptionalCatalog(resource, meta, controller.signal).then(
      (catalog) => setState((current) => {
        if (controller.signal.aborted || current.data?.meta.release_id !== meta.release_id) return current;
        return {...current, data: {...current.data, [resource]: catalog, resources: {
          ...current.data.resources, [resource]: {status: "ready", error: ""},
        }}};
      }),
      (cause: unknown) => setState((current) => {
        if (controller.signal.aborted || current.data?.meta.release_id !== meta.release_id) return current;
        return {...current, data: {...current.data, resources: {...current.data.resources,
          [resource]: {status: "error", error: cause instanceof Error ? cause.message : String(cause)},
        }}};
      }),
    );
    return () => controller.abort();
  }, [resource, meta, attempt, setState]);
}

export function useAppData() {
  const [attempt, setAttempt] = useState(0);
  const [optionalAttempts, setOptionalAttempts] = useState({models: 0, orthography: 0, content: 0});
  const [state, setState] = useState<DataState>({data: null, error: null, loading: true});
  useEffect(() => {
    const controller = new AbortController();
    loadAppData(controller.signal).then(
      (data) => { if (!controller.signal.aborted) setState({data, error: null, loading: false}); },
      (cause: unknown) => {
        if (!controller.signal.aborted) setState((current) => ({
          ...current, error: cause instanceof Error ? cause : new Error(String(cause)), loading: false,
        }));
      },
    );
    return () => controller.abort();
  }, [attempt]);
  useOptionalCatalog("models", state.data?.meta, optionalAttempts.models, setState);
  useOptionalCatalog("orthography", state.data?.meta, optionalAttempts.orthography, setState);
  useOptionalCatalog("content", state.data?.meta, optionalAttempts.content, setState);

  const releaseId = state.data?.meta.release_id;
  const queryAvailable = state.data?.query.available;
  useEffect(() => {
    if (!releaseId || queryAvailable) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const retry = async () => {
      let error = "";
      try {
        await checkApiRelease(releaseId, controller.signal);
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      if (controller.signal.aborted) return;
      setState((current) => {
        if (!current.data || current.data.meta.release_id !== releaseId) return current;
        return {...current, data: {...current.data, query: {baseUrl: apiBaseUrl, available: !error, error}}};
      });
      if (error) timer = setTimeout(retry, 15_000 + Math.floor(Math.random() * 1_000));
    };
    void retry();
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [queryAvailable, releaseId]);
  const retryResource = useCallback((resource: OptionalResource) => {
    setState((current) => current.data ? {...current, data: {...current.data,
      resources: {...current.data.resources, [resource]: {status: "loading", error: ""}},
    }} : current);
    setOptionalAttempts((current) => ({...current, [resource]: current[resource] + 1}));
  }, []);
  const reload = useCallback(() => {
    setState((current) => ({...current, error: null, loading: !current.data}));
    setAttempt((value) => value + 1);
  }, []);
  return {...state, reload, retryResource};
}
