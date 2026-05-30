import hashlib
from collections import OrderedDict

_MAX_BYTES = 500 * 1024 * 1024  # 500 MB


class _LRUCache:
    def __init__(self, max_bytes: int):
        self._store: OrderedDict[str, bytes] = OrderedDict()
        self._used  = 0
        self._max   = max_bytes

    def put(self, content: bytes) -> str:
        key = hashlib.sha256(content).hexdigest()
        if key in self._store:
            self._store.move_to_end(key)
            return key
        self._store[key] = content
        self._used += len(content)
        self._evict()
        return key

    def get(self, key: str) -> bytes | None:
        if key not in self._store:
            return None
        self._store.move_to_end(key)
        return self._store[key]

    def _evict(self) -> None:
        while self._used > self._max and self._store:
            _, val = self._store.popitem(last=False)
            self._used -= len(val)


_cache = _LRUCache(_MAX_BYTES)

def cache_put(content: bytes) -> str:  return _cache.put(content)
def cache_get(key: str) -> bytes | None: return _cache.get(key)
