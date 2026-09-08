import {execFileSync} from "node:child_process";
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import standalone from "ajv/dist/standalone/index.js";
import {compile} from "json-schema-to-typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const schema = JSON.parse(execFileSync("uv", ["run", "--locked", "python", "-c", "import json; from api.contracts import response_schema; print(json.dumps(response_schema()))"], {cwd: root, encoding: "utf8"}));
// Existing conditional schemas inherit their type from the surrounding object.
const ajv = new Ajv({strictTypes: false, inlineRefs: false, messages: false, code: {source: true, optimize: 2}});
addFormats(ajv);
for (const name of readdirSync(`${root}schemas`).filter((name) => name.endsWith(".schema.json"))) {
  ajv.addSchema(JSON.parse(readFileSync(`${root}schemas/${name}`, "utf8")));
}
ajv.addSchema(schema);
const names = ["Ready", "ExportReady", "DictionaryPage", "ConcordancePage", "SearchRecord", "SummaryResponse", "TranslationLanguages", "DatasetPreviewResult"];
const mapping = Object.fromEntries(names.map((name) => [name, `${schema.$id}#/$defs/${name}`]));
mapping.StaticEnvelope = "https://formosanbank.github.io/kakarayan/schemas/static-api.schema.json";
const output = `${root}site/node_modules/.cache/kakarayan-contracts`;
mkdirSync(output, {recursive: true});
writeFileSync(`${output}/validators.cjs`, standalone(ajv, mapping));
writeFileSync(`${output}/validators.d.cts`,
  'import type * as T from "../../../src/contractTypes";\nimport type {ApiEnvelope} from "../../../src/types";\n' +
  names.map((name) => `export function ${name}(value: unknown): value is T.${name};`).join("\n") +
  '\nexport function StaticEnvelope<T>(value: unknown): value is ApiEnvelope<T>;\n');
// Pydantic titles every scalar property. Drop those titles to avoid hundreds of
// meaningless aliases such as Id1 and Text2 in the generated declarations.
const typeSchema = JSON.parse(JSON.stringify(schema, (key, value) => key === "title" ? undefined : value));
typeSchema.title = "ApiResponse";
const types = await compile(typeSchema, "ApiResponse", {
  bannerComment: "/* Generated from api/contracts.py. Run npm run contracts. */",
  unknownAny: true, unreachableDefinitions: true, style: {singleQuote: false},
});
writeFileSync(`${root}site/src/contractTypes.d.ts`, types);
