// Corpus metadata, model output, and imported deck cards are not authored by Kakarayan.
// These helpers keep that text from changing the structure of files and clipboard text the
// site generates.

/** Prefixes a cell that a spreadsheet would otherwise evaluate as a formula. */
export function spreadsheetCell(value: string): string {
  return /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
}

/** Collapses line breaks and control characters, so a value cannot start a new line or record. */
export function singleLine(value: string): string {
  return value.replace(/[\p{Cc}\u2028\u2029]+/gu, " ").trim();
}

export function risRecord(fields: Array<[tag: string, value: string]>): string {
  return [
    "TY  - GEN",
    ...fields.map(([tag, value]) => `${tag}  - ${singleLine(value)}`),
    "ER  -",
  ].join("\n");
}

// Accents and text formatting only. Anything else, such as \input or \write18, could act on
// the machine that builds the bibliography.
const BIBTEX_COMMANDS = new Set([
  "url", "emph", "textit", "textbf", "textsc",
  "c", "v", "u", "H", "k", "r", "d", "b", "t", "i", "j", "o", "O", "l", "L",
  "ss", "ae", "AE", "aa", "AA", "oe", "OE",
]);

/** Returns source BibTeX only if it is balanced entries that use safe commands. */
export function safeBibtex(value: string): string | null {
  const source = value.trim();
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (depth === 0) {
      // Between entries only separators and the start of another entry are allowed.
      if (/[\s,]/u.test(char)) continue;
      const start = /^@[A-Za-z]+\s*\{/u.exec(source.slice(index))?.[0];
      if (!start) return null;
      depth = 1;
      index += start.length - 1;
    } else if (char === "\\") {
      const command = /^[A-Za-z]+/u.exec(source.slice(index + 1))?.[0];
      if (command && !BIBTEX_COMMANDS.has(command)) return null;
      index += command ? command.length : 1;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
    }
  }
  return source && depth === 0 ? source : null;
}
