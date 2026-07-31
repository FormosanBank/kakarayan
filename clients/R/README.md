# R client

The small R package reads Kakarayan's static catalogues and search shards and can opt into
the live read-only API.

```r
static <- kakarayan_client(
  "https://formosanbank.github.io/kakarayan",
  release_id = "fb-YYYYMMDD-commit"
)
kakarayan_languages(static)
manifest <- kakarayan_search_manifest(static)
shard <- manifest$shards[[1L]]
records <- kakarayan_search_shard(
  static,
  shard$path,
  shard$sha256,
  shard$uncompressed_sha256
)

live <- kakarayan_client("https://PUBLIC_SPACE.hf.space", mode = "live")
kakarayan_dictionary(live, "lima", "lang_amis", match = "exact")
```

It provides exact release pinning, timeouts, cursor collection, structured conditions, and
SHA-256 verification for compressed and decoded static search data. Runtime dependencies
are `curl`, `jsonlite`, and `digest`.
