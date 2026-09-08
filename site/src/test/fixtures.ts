import type {AppData} from "../types";

export function appFixture(): AppData {
  return {
    meta: {
      schema_version: "1.0.0", api_version: "v1", endpoint: "meta", release_id: "fixture-release",
      generated_at: "2026-01-01T00:00:00.000Z", canonical_url: "https://example.test/meta.json",
      kakarayan: {repository: "FormosanBank/kakarayan", version: "0.2.0", commit: "a".repeat(40)},
      source: {repository: "FormosanBank/FormosanBank", commit: "b".repeat(40)},
      data: {current_release: "fixture-release"},
    },
    languages: [
      {id: "lang_amis", name: "Amis", iso639_3: "ami", names: {en: "Amis", "zh-Hant": "阿美語", autonym: ""},
        capabilities: [], dialects: ["Coastal"], counts: {sentences: 2}},
      {id: "lang_atayal", name: "Atayal", iso639_3: "tay", names: {en: "Atayal", "zh-Hant": "泰雅語", autonym: ""},
        capabilities: [], dialects: [], counts: {sentences: 3}},
    ],
    corpora: [{id: "corpus_fixture", name: "Fixture", source_path: "Corpora/Fixture",
      languages: ["lang_amis", "lang_atayal"], rights_id: "rights_fixture", citation: "Synthetic fixture",
      bibtex_citation: "", source: "", copyright: "", counts: {sentences: 5},
      language_counts: {lang_amis: {sentences: 2}, lang_atayal: {sentences: 3}},
      metadata_variants: {citation: 1, bibtex_citation: 0, source: 0, copyright: 0},
    }],
    rights: {schema_version: "1.0.0", entries: [], central_terms: {
      use_summary: "Fixture", commercial_ai: "prohibited", attribution_required: true, evidence: [],
    }},
    models: {schema_version: "1.0.0", generated_at: "2026-01-01T00:00:00.000Z",
      provider: "Hugging Face", models: [], services: [{
        id: "fixture", space: "fixture/test", url: "https://example.test", api_url: null,
        api_name: "/test", tasks: ["translation", "automatic-speech-recognition"],
        supported_languages: ["Amis", "Atayal"], status: "unchecked", checked_at: null,
        third_party_notice: "Fixture only",
      }],
    },
    orthography: {schema_version: "1.0.0", source_commit: "b".repeat(40), tables: [{
      id: "fixture", language: "Amis", name: "Fixture", source_path: "fixture.tsv",
      dialects: ["Coastal"], rules: [{input: "a", outputs: {Coastal: "a"}}],
    }]},
    content: {schema_version: "1.0.0", entries: []},
    query: {baseUrl: "https://example.test", available: false, error: "Fixture offline"},
    resources: {
      models: {status: "ready", error: ""}, orthography: {status: "ready", error: ""},
      content: {status: "ready", error: ""},
    },
  };
}
