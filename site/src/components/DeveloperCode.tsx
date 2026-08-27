import {useMemo, useState} from "react";

import {useI18n} from "../i18n";

type ExampleLanguage = "curl" | "javascript" | "python" | "r";
type CodeLanguage = ExampleLanguage | "json";
type TokenKind = "comment" | "function" | "keyword" | "literal" | "property" | "string";

type CodeToken = {
  kind?: TokenKind;
  text: string;
};

const KEYWORDS: Record<CodeLanguage, ReadonlySet<string>> = {
  curl: new Set(["curl"]),
  javascript: new Set([
    "async", "await", "const", "else", "export", "from", "if", "import", "let", "new",
    "return", "throw", "var",
  ]),
  json: new Set(),
  python: new Set([
    "as", "async", "await", "def", "elif", "else", "for", "from", "if", "import", "in",
    "return", "with", "while", "yield",
  ]),
  r: new Set(["break", "else", "for", "function", "if", "in", "next", "repeat", "while"]),
};

const LITERALS = new Set(["false", "null", "None", "NULL", "true", "True", "TRUE", "False", "FALSE"]);
const TOKEN_PATTERN = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/.*$|#.*$|--?[A-Za-z][\w-]*|\b[A-Za-z_][\w]*\b|\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/giu;

const EXAMPLE_LANGUAGES: Array<{id: ExampleLanguage; label: string}> = [
  {id: "curl", label: "curl"},
  {id: "javascript", label: "JavaScript"},
  {id: "python", label: "Python"},
  {id: "r", label: "R"},
];

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function tokenKind(token: string, rest: string, language: CodeLanguage): TokenKind | undefined {
  if ((token.startsWith("//") && language === "javascript")
    || (token.startsWith("#") && language !== "javascript" && language !== "json")) {
    return "comment";
  }
  if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) {
    return language === "json" && rest.trimStart().startsWith(":") ? "property" : "string";
  }
  if (/^\d/u.test(token) || LITERALS.has(token)) return "literal";
  if (KEYWORDS[language].has(token) || (language === "curl" && token.startsWith("-"))) {
    return "keyword";
  }
  if (rest.trimStart().startsWith("(")) return "function";
  return undefined;
}

function syntaxTokens(line: string, language: CodeLanguage): CodeToken[] {
  const tokens: CodeToken[] = [];
  let cursor = 0;

  for (const match of line.matchAll(TOKEN_PATTERN)) {
    const index = match.index;
    if (index > cursor) tokens.push({text: line.slice(cursor, index)});
    const text = match[0];
    const kind = tokenKind(text, line.slice(index + text.length), language);
    tokens.push(kind ? {kind, text} : {text});
    cursor = index + text.length;
  }

  if (cursor < line.length) tokens.push({text: line.slice(cursor)});
  return tokens;
}

function requestExamples(url: string): Record<ExampleLanguage, string> {
  const request = new URL(url);
  const endpoint = `${request.origin}${request.pathname}`;
  const parameters = [...request.searchParams.entries()];
  const curlLines = [
    `curl --get ${shellQuote(endpoint)} \\`,
    ...parameters.map(
      ([key, value], index) =>
        `  --data-urlencode ${shellQuote(`${key}=${value}`)}${index < parameters.length - 1 ? " \\" : ""}`,
    ),
  ];
  const javascriptParameters = parameters.map(
    ([key, value]) => `  [${JSON.stringify(key)}, ${JSON.stringify(value)}],`,
  );
  const pythonParameters = parameters.map(
    ([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)},`,
  );
  const rParameters = parameters.map(
    ([key, value]) => `    ${key} = ${JSON.stringify(value)},`,
  );

  return {
    curl: curlLines.join("\n"),
    javascript: [
      `const url = new URL(${JSON.stringify(endpoint)});`,
      "url.search = new URLSearchParams([",
      ...javascriptParameters,
      "]).toString();",
      "",
      "const response = await fetch(url, {",
      '  headers: {Accept: "application/json"},',
      "});",
      "if (!response.ok) throw new Error(`HTTP ${response.status}`);",
      "const page = await response.json();",
      "console.log(page.items);",
    ].join("\n"),
    python: [
      "import json",
      "from urllib.parse import urlencode",
      "from urllib.request import urlopen",
      "",
      "parameters = {",
      ...pythonParameters,
      "}",
      `url = ${JSON.stringify(endpoint)} + "?" + urlencode(parameters)`,
      "with urlopen(url) as response:",
      '    page = json.load(response)',
      'print(page["items"])',
    ].join("\n"),
    r: [
      `response <- httr2::request(${JSON.stringify(endpoint)}) |>`,
      "  httr2::req_url_query(",
      ...rParameters,
      "  ) |>",
      "  httr2::req_perform()",
      "",
      "page <- httr2::resp_body_json(response)",
      "page$items",
    ].join("\n"),
  };
}

export function CodeLines({
  label,
  language,
  value,
}: {
  label: string;
  language: CodeLanguage;
  value: string;
}) {
  return (
    <pre className="code-lines" aria-label={label} tabIndex={0}>
      <code>
        {value.split("\n").map((line, index) => (
          <span className="code-lines__line" key={`${index}-${line}`}>
            <span className="code-lines__number" aria-hidden="true">{index + 1}</span>
            <span className="code-lines__text">
              {line
                ? syntaxTokens(line, language).map((token, tokenIndex) => token.kind
                  ? <span className={`code-token code-token--${token.kind}`} key={`${tokenIndex}-${token.text}`}>{token.text}</span>
                  : token.text)
                : "\u00a0"}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
}

export function RequestExamples({url}: {url: string}) {
  const {tx} = useI18n();
  const [language, setLanguage] = useState<ExampleLanguage>("curl");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable">("idle");
  const examples = useMemo(() => requestExamples(url), [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(examples[language]);
      setCopyState("copied");
    } catch {
      setCopyState("unavailable");
    }
    window.setTimeout(() => setCopyState("idle"), 1_500);
  }

  return (
    <section className="code-example" aria-labelledby="code-example-title">
      <div className="code-example__header">
        <h3 id="code-example-title">{tx("Use this request", "使用此請求")}</h3>
        <button className="text-button code-example__copy" type="button" onClick={() => void copy()}>
          {copyState === "copied"
            ? tx("Copied", "已複製")
            : copyState === "unavailable"
              ? tx("Copy unavailable", "無法複製")
              : tx("Copy code", "複製程式碼")}
        </button>
      </div>
      <div className="code-example__tabs" role="tablist" aria-label={tx("Code language", "程式語言")}>
        {EXAMPLE_LANGUAGES.map((option) => (
          <button
            id={`code-tab-${option.id}`}
            key={option.id}
            role="tab"
            aria-controls="code-example-panel"
            aria-selected={language === option.id}
            onClick={() => setLanguage(option.id)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      <div id="code-example-panel" role="tabpanel" aria-labelledby={`code-tab-${language}`}>
        <CodeLines
          label={tx(
            `${EXAMPLE_LANGUAGES.find((option) => option.id === language)?.label} example`,
            `${EXAMPLE_LANGUAGES.find((option) => option.id === language)?.label} 範例`,
          )}
          language={language}
          value={examples[language]}
        />
      </div>
    </section>
  );
}
