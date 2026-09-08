"""Stage measurements kept outside immutable release artifacts."""

import json
import resource
import sys
import time
from pathlib import Path


class StageProfile:
    def __init__(self) -> None:
        self.started = self.previous = time.perf_counter()
        self.stages: list[dict[str, object]] = []

    def mark(self, name: str, **measurements: object) -> None:
        now = time.perf_counter()
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        row = {
            "stage": name,
            "seconds": round(now - self.previous, 3),
            "peak_rss_bytes": peak if sys.platform == "darwin" else peak * 1024,
            **measurements,
        }
        self.stages.append(row)
        self.previous = now

    def write(self, path: Path, **identity: object) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    **identity,
                    "seconds": round(time.perf_counter() - self.started, 3),
                    "stages": self.stages,
                },
                indent=2,
            )
            + "\n"
        )
