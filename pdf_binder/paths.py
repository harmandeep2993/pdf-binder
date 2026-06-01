"""Path resolution that works both from source and from a PyInstaller bundle.

When frozen by PyInstaller:
  - read-only assets (index.html, static/) are unpacked into sys._MEIPASS
  - writable files (history.db, output/) must live in a stable location, so we
    put them next to the executable rather than in the temp unpack dir.
"""
import sys
from pathlib import Path

_FROZEN = getattr(sys, "frozen", False)


def resource_dir() -> Path:
    """Directory holding bundled read-only assets (index.html, static/)."""
    if _FROZEN:
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent.parent


def data_dir() -> Path:
    """Directory for writable runtime files (history.db, output/)."""
    if _FROZEN:
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent
