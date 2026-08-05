"""Simple on-disk cache so we don't hammer public endpoints."""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "cache"


def _key_path(key: str, suffix: str) -> Path:
    digest = hashlib.sha256(key.encode()).hexdigest()[:20]
    return CACHE_DIR / f"{digest}{suffix}"


def get(key: str, max_age_s: float, suffix: str = ".json") -> Any | None:
    path = _key_path(key, suffix)
    if not path.exists():
        return None
    if time.time() - path.stat().st_mtime > max_age_s:
        return None
    text = path.read_text()
    return json.loads(text) if suffix == ".json" else text


def put(key: str, value: Any, suffix: str = ".json") -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _key_path(key, suffix)
    path.write_text(json.dumps(value) if suffix == ".json" else value)
