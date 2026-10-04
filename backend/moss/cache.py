"""Memory layer 1 — in-process TTL cache for LLM answers, API reads and hot graph lookups."""
import hashlib
import json
import time
from typing import Any, Awaitable, Callable

from cachetools import TTLCache

_caches: dict[str, TTLCache] = {}
stats = {"hits": 0, "misses": 0, "saved_ms": 0.0}
_cost: dict[tuple[str, str], float] = {}


def _ns(name: str, ttl: int, size: int = 512) -> TTLCache:
    if name not in _caches:
        _caches[name] = TTLCache(maxsize=size, ttl=ttl)
    return _caches[name]


def key_of(*parts: Any) -> str:
    return hashlib.sha256(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()


async def get_or_set(ns: str, key: str, ttl: int, fn: Callable[[], Awaitable[Any]]) -> Any:
    cache = _ns(ns, ttl)
    if key in cache:
        stats["hits"] += 1
        stats["saved_ms"] += _cost.get((ns, key), 0.0)
        return cache[key]
    stats["misses"] += 1
    started = time.perf_counter()
    value = await fn()
    if value is not None:
        cache[key] = value
        _cost[(ns, key)] = (time.perf_counter() - started) * 1000
    return value


def invalidate(ns: str | None = None) -> None:
    for name, cache in _caches.items():
        if ns is None or name == ns:
            cache.clear()


def snapshot() -> dict:
    return {**stats, "saved_ms": round(stats["saved_ms"]), "namespaces": {n: len(c) for n, c in _caches.items()}}
