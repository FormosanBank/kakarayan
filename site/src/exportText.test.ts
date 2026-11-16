import {risRecord, safeBibtex, singleLine, spreadsheetCell} from "./exportText";

describe("generated text from untrusted values", () => {
  it("marks spreadsheet formulas as text", () => {
    for (const formula of ["=1+1", "+1", "-2+3", "@SUM(1)", "\tx"]) {
      expect(spreadsheetCell(formula)).toBe(`'${formula}`);
    }
    expect(spreadsheetCell("lima")).toBe("lima");
  });

  it("collapses line breaks so a value cannot add a line", () => {
    expect(singleLine("Amis\nrm -rf ~\r x\u0000y ")).toBe("Amis rm -rf ~ x y");
  });

  it("keeps a RIS value inside its own field", () => {
    const value = risRecord([["T1", "Amis\nER  -\nTY  - GEN\nL1  - file:///etc/passwd"]]);
    expect(value.split("\n")).toEqual([
      "TY  - GEN",
      "T1  - Amis ER  - TY  - GEN L1  - file:///etc/passwd",
      "ER  -",
    ]);
  });

  it("accepts real source BibTeX entries", () => {
    for (const entry of [
      "@book{cuerq_pourrias_2002, author={Cuerq, G{\\'e}rard and Pourrias, Louis}, title={O Citig}}",
      "@misc{x, title={Site}, howpublished={\\url{https://example.org}}}",
      "@book{Gravius1661,\n  author    = {Gravius, Daniël},\n  year      = {1661}\n}",
      "@article{a, title={Amis dictionary}}, @misc{b, howpublished={\\url{https://github.com/x}}}",
    ]) {
      expect(safeBibtex(`${entry}\n`)).toBe(entry);
    }
  });

  it("withholds BibTeX that could run commands or carry text outside an entry", () => {
    for (const entry of [
      "@book{a, title={x}} @misc{b, note={\\input{/etc/passwd}}}",
      "@book{a, title={x}} \\immediate\\write18{calc}",
      "@book{a, title={x\\immediate\\write18{calc}}}",
      "@book{a, title={x}",
      "@book{a, title={x}}}",
      "author={x}",
      "",
    ]) {
      expect(safeBibtex(entry)).toBeNull();
    }
  });
});
