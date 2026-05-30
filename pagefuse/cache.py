import hashlib

_store: dict[str, bytes] = {}

def cache_put(content: bytes) -> str:
    key = hashlib.sha256(content).hexdigest()
    _store[key] = content
    return key

def cache_get(key: str) -> bytes | None:
    return _store.get(key)
