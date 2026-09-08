import {createHash} from "node:crypto";
import {readFileSync, readdirSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import type {Plugin} from "vite";

export function offlineShell(): Plugin {
  return {
    name: "kakarayan-offline-shell", enforce: "post", apply: "build",
    writeBundle(options, bundle) {
      const outputDir = resolve(options.dir ?? "dist");
      const files = Object.entries(bundle).filter(([name]) => name === "index.html" || name.startsWith("assets/"));
      if (!bundle["index.html"]) throw new Error("Offline generation has no HTML shell");
      const entries = files.map(([path]) => {
        const bytes = readFileSync(resolve(outputDir, path));
        return {path: path === "index.html" ? "./" : path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), required: true};
      });
      const publicDir = fileURLToPath(new URL("./public/", import.meta.url));
      for (const path of ["icon.svg", "manifest.webmanifest", ...readdirSync(`${publicDir}api/v1`).filter((name) => name.endsWith(".json")).map((name) => `api/v1/${name}`)]) {
        const bytes = readFileSync(`${publicDir}${path}`);
        entries.push({path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
          required: !path.startsWith("api/") || /\/(meta|languages|corpora|rights)\.json$/u.test(path)});
      }
      entries.sort((a, b) => a.path.localeCompare(b.path));
      const generation = createHash("sha256").update(JSON.stringify(entries)).digest("hex").slice(0, 20);
      const template = readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
      writeFileSync(resolve(outputDir, "sw.js"), template.replace("__KAKARAYAN_SHELL__", JSON.stringify({generation, entries})));
    },
  };
}
