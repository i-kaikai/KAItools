"""Keep a persistent WebView2 profile without reusing frontend assets from an older app version."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from .paths import AppPaths

LOGGER = logging.getLogger(__name__)
_CACHE_DIRECTORIES = ("Cache", "Code Cache")
_CACHE_LAYOUT_VERSION = "2"


def _read_version_marker(path: Path) -> str | None:
    try:
        value = path.read_text(encoding="ascii").strip()
    except FileNotFoundError:
        return None
    except OSError:
        LOGGER.warning("webview_cache_version_read_failed path=%s", path, exc_info=True)
        return None
    return value or None


def _remove_cache_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)


def _write_version_marker(path: Path, app_version: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    try:
        temporary.write_text(f"{app_version}\n", encoding="ascii")
        temporary.replace(path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _marker_value(app_version: str) -> str:
    return f"{app_version}:cache-layout-{_CACHE_LAYOUT_VERSION}"


def invalidate_webview_asset_cache(paths: AppPaths, app_version: str) -> bool:
    """Clear only HTTP/code caches once per packaged app version.

    Cookies, Local Storage, and the rest of the WebView profile intentionally remain untouched.
    """

    marker = paths.webview_cache_version_file
    previous_marker = _read_version_marker(marker)
    current_marker = _marker_value(app_version)
    if previous_marker == current_marker:
        return False

    profile = paths.webview_default_profile_dir
    try:
        for name in _CACHE_DIRECTORIES:
            _remove_cache_path(profile / name)
        _write_version_marker(marker, current_marker)
    except OSError:
        LOGGER.warning(
            "webview_asset_cache_invalidation_failed previous_marker=%s current_marker=%s",
            previous_marker,
            current_marker,
            exc_info=True,
        )
        return False

    LOGGER.info(
        "webview_asset_cache_invalidated previous_marker=%s current_marker=%s",
        previous_marker,
        current_marker,
    )
    return True
