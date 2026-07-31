# Python client

This dependency-free package reads Kakarayan's static API by default and can use the
optional live API.

```python
from kakarayan_client import KakarayanClient

static = KakarayanClient(
    "https://formosanbank.github.io/kakarayan",
    release_id="fb-YYYYMMDD-commit",
)
print(static.languages())

live = KakarayanClient("https://PUBLIC_SPACE.hf.space", mode="live")
print(live.dictionary("lima", "lang_amis", match="exact"))
```

The `kakarayan` command exposes the same catalogue and query methods. The client supports
timeouts, cursor iteration, release pinning, structured errors, and streaming SHA-256
download verification without third-party runtime dependencies.
