"""Resolve the product version from the repository's authoritative VERSION file."""

from __future__ import annotations

import re
import sys
from pathlib import Path


def _version_file() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "VERSION"  # type: ignore[attr-defined]
    return Path(__file__).resolve().parents[2] / "VERSION"


def _read_version() -> str:
    version = _version_file().read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise RuntimeError(f"Invalid KAITools version: {version!r}")
    return version


APP_VERSION = _read_version()
