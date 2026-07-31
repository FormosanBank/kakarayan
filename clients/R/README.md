# R client

The small R package reads Kakarayan's static catalogues and search shards and can opt into
the live read-only API.

```r
static <- kakarayan_client(
  "https://formosanbank.github.io/kakarayan",
  release_id = "fb-YYYYMMDD-commit"
)
kakarayan_languages(static)

live <- kakarayan_client("https://PUBLIC_SPACE.hf.space", mode = "live")
kakarayan_dictionary(live, "lima", "lang_amis", match = "exact")
```

It provides exact release pinning, timeouts, cursor collection, structured conditions, and
SHA-256 download verification. Runtime dependencies are `curl`, `jsonlite`, and `digest`.
