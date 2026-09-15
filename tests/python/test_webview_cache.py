from __future__ import annotations

from pathlib import Path

from devtoolkit.paths import AppPaths
from devtoolkit.webview_cache import invalidate_webview_asset_cache


def app_paths(tmp_path: Path) -> AppPaths:
    return AppPaths(tmp_path, tmp_path / "resources", tmp_path / "data")


def test_version_change_clears_only_webview_asset_caches(tmp_path: Path) -> None:
    paths = app_paths(tmp_path)
    profile = paths.webview_default_profile_dir
    cache_file = profile / "Cache" / "Cache_Data" / "data_0"
    code_cache_file = profile / "Code Cache" / "js" / "bytecode"
    cookies = profile / "Network" / "Cookies"
    local_storage = profile / "Local Storage" / "leveldb" / "000001.log"
    cache_file.parent.mkdir(parents=True)
    code_cache_file.parent.mkdir(parents=True)
    cookies.parent.mkdir(parents=True)
    local_storage.parent.mkdir(parents=True)
    cache_file.write_text("stale frontend", encoding="utf-8")
    code_cache_file.write_text("stale bytecode", encoding="utf-8")
    cookies.write_text("session cookie", encoding="utf-8")
    local_storage.write_text("workspace state", encoding="utf-8")
    paths.webview_cache_version_file.parent.mkdir(parents=True, exist_ok=True)
    paths.webview_cache_version_file.write_text("1.4.5\n", encoding="ascii")

    assert invalidate_webview_asset_cache(paths, "1.4.6") is True

    assert not (profile / "Cache").exists()
    assert not (profile / "Code Cache").exists()
    assert cookies.read_text(encoding="utf-8") == "session cookie"
    assert local_storage.read_text(encoding="utf-8") == "workspace state"
    assert paths.webview_cache_version_file.read_text(encoding="ascii") == "1.4.6:cache-layout-2\n"


def test_current_version_does_not_clear_webview_asset_cache(tmp_path: Path) -> None:
    paths = app_paths(tmp_path)
    cache_file = paths.webview_default_profile_dir / "Cache" / "Cache_Data" / "data_0"
    cache_file.parent.mkdir(parents=True)
    cache_file.write_text("current frontend", encoding="utf-8")
    paths.webview_cache_version_file.parent.mkdir(parents=True, exist_ok=True)
    paths.webview_cache_version_file.write_text("1.4.6:cache-layout-2\n", encoding="ascii")

    assert invalidate_webview_asset_cache(paths, "1.4.6") is False
    assert cache_file.read_text(encoding="utf-8") == "current frontend"
