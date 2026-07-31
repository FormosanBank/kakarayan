import * as duckdb from "@duckdb/duckdb-wasm";
import duckdbWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import duckdbWasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";

export async function parquetFromRows(
  rows: Array<Record<string, string>>,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
  const worker = new Worker(duckdbWorker);
  const database = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  const onAbort = () => {
    void database.terminate();
  };
  signal?.addEventListener("abort", onAbort, {once: true});
  try {
    await database.instantiate(duckdbWasm);
    await database.registerFileText("selection.json", JSON.stringify(rows));
    const connection = await database.connect();
    try {
      await connection.insertJSONFromPath("selection.json", {
        name: "selection",
        schema: "main",
      });
      await connection.query(
        "COPY (SELECT * FROM selection) TO 'selection.parquet' " +
          "(FORMAT PARQUET, COMPRESSION ZSTD)",
      );
      const result = await database.copyFileToBuffer("selection.parquet");
      if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
      return result;
    } finally {
      await connection.close();
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await database.terminate();
  }
}
