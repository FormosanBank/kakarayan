"""Small-process request controls for the public query service."""

from __future__ import annotations

import math
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from threading import Lock


@dataclass(frozen=True)
class RatePolicy:
    requests_per_minute: int
    burst: int


@dataclass(frozen=True)
class RateDecision:
    allowed: bool
    limit: int
    remaining: int
    retry_after: int
    scope: str


@dataclass
class _Bucket:
    tokens: float
    updated_at: float


@dataclass
class _ClientBuckets:
    requests: _Bucket
    exports: _Bucket


class PerIpRateLimiter:
    """Thread-safe token buckets bounded to a finite client LRU."""

    def __init__(
        self,
        request_policy: RatePolicy,
        export_policy: RatePolicy,
        *,
        clock: Callable[[], float] = time.monotonic,
        max_clients: int = 10_000,
    ) -> None:
        self.request_policy = request_policy
        self.export_policy = export_policy
        self.clock = clock
        self.max_clients = max_clients
        self._clients: OrderedDict[str, _ClientBuckets] = OrderedDict()
        self._lock = Lock()

    @staticmethod
    def _consume(bucket: _Bucket, policy: RatePolicy, now: float, scope: str) -> RateDecision:
        elapsed = max(0.0, now - bucket.updated_at)
        refill_per_second = policy.requests_per_minute / 60
        bucket.tokens = min(policy.burst, bucket.tokens + elapsed * refill_per_second)
        bucket.updated_at = now
        if bucket.tokens >= 1:
            bucket.tokens -= 1
            return RateDecision(
                allowed=True,
                limit=policy.requests_per_minute,
                remaining=math.floor(bucket.tokens),
                retry_after=0,
                scope=scope,
            )
        return RateDecision(
            allowed=False,
            limit=policy.requests_per_minute,
            remaining=0,
            retry_after=max(1, math.ceil((1 - bucket.tokens) / refill_per_second)),
            scope=scope,
        )

    def check(self, client_ip: str, *, is_export: bool) -> RateDecision:
        now = self.clock()
        with self._lock:
            buckets = self._clients.pop(client_ip, None)
            if buckets is None:
                if len(self._clients) >= self.max_clients:
                    self._clients.popitem(last=False)
                buckets = _ClientBuckets(
                    requests=_Bucket(float(self.request_policy.burst), now),
                    exports=_Bucket(float(self.export_policy.burst), now),
                )
            self._clients[client_ip] = buckets

            request_decision = self._consume(buckets.requests, self.request_policy, now, "requests")
            if not request_decision.allowed or not is_export:
                return request_decision
            return self._consume(buckets.exports, self.export_policy, now, "exports")
