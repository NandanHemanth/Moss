"""Short-lived memory: recent answers and tool results, expiring after a TTL."""

import threading
import time
from typing import Any

from ..config import CACHE_TTL_SECONDS


class TTLCache:
    def __init__(self, ttl_seconds: int) -> None:
        self.ttl = ttl_seconds
        self._items: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    @staticmethod
    def key(*parts: str) -> str:
        return "|".join(" ".join(p.lower().split()) for p in parts)

    def get(self, key: str) -> tuple[Any, float] | None:
        """Returns (value, age_seconds) or None if missing or expired."""
        with self._lock:
            item = self._items.get(key)
            if not item:
                return None
            stored_at, value = item
            age = time.time() - stored_at
            if age > self.ttl:
                del self._items[key]
                return None
            return value, age

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._items[key] = (time.time(), value)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()


cache = TTLCache(CACHE_TTL_SECONDS)
