# JavaScript client

The dependency-free typed client reads Kakarayan's static GitHub Pages API by default and
can opt into the live read-only API.

```ts
import {KakarayanClient} from "@formosanbank/kakarayan-client";

const staticApi = new KakarayanClient({
  baseUrl: "https://formosanbank.github.io/kakarayan",
  releaseId: "fb-YYYYMMDD-commit",
});
const languages = await staticApi.getLanguages();

const liveApi = new KakarayanClient({
  baseUrl: "https://PUBLIC_SPACE.hf.space",
  mode: "live",
});
const matches = await liveApi.dictionary({
  q: "lima",
  language_id: "lang_amis",
  match: "exact",
});
```

The client supports timeouts, opaque cursor iteration, structured errors, release pinning,
static search shards, and SHA-256 download verification.
