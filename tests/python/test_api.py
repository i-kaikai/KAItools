from __future__ import annotations

from pathlib import Path

import devtoolkit.api as api_module
from devtoolkit.api import DesktopApi
from devtoolkit.hosts import create_backup, execute_request, sha256_bytes
from devtoolkit.paths import AppPaths
from devtoolkit.storage import AppStorage


def app_paths(tmp_path: Path) -> AppPaths:
    return AppPaths(tmp_path, tmp_path / "resources", tmp_path / "data")


def test_api_preview_uses_result_envelope_and_rejects_unknown_fields(tmp_path: Path) -> None:
    paths = app_paths(tmp_path)
    storage = AppStorage(paths)
    storage.ensure_directories()
    target = tmp_path / "hosts"
    target.write_bytes(b"127.0.0.1 localhost\r\n")
    api = DesktopApi(paths, storage, target)
    source_sha256 = sha256_bytes(target.read_bytes())
    content = "127.0.0.1 localhost\n127.0.0.1 api.local\n"

    preview = api.apply_hosts(
        {"content": content, "sourceSha256": source_sha256, "previewOnly": True}
    )
    invalid = api.apply_hosts(
        {
            "content": content,
            "sourceSha256": source_sha256,
            "previewOnly": True,
            "command": "whoami",
        }
    )

    assert preview["ok"] is True
    assert preview["data"]["changed"] is True
    assert "api.local" in preview["data"]["desiredContent"]
    assert invalid["ok"] is False
    assert invalid["error"]["code"] == "HOSTS_APPLY_FAILED"


def test_restore_replaces_complete_hosts_file_from_backup(
    tmp_path: Path, monkeypatch
) -> None:
    paths = app_paths(tmp_path)
    storage = AppStorage(paths)
    storage.ensure_directories()
    target = tmp_path / "hosts"
    current = (
        b"# current-before\r\n"
        b"127.0.0.1\tcurrent.local\r\n"
        b"# current-after\r\n"
    )
    historical = (
        b"# historical-before\r\n"
        b"127.0.0.2\thistorical.local\r\n"
        b"# historical-after\r\n"
    )
    target.write_bytes(current)
    backup = create_backup(paths, historical)

    def execute_without_uac(request_path: Path, digest: str) -> int:
        return execute_request(request_path, digest, paths, target)

    monkeypatch.setattr(api_module, "run_elevated_request", execute_without_uac)
    result = DesktopApi(paths, storage, target).restore_hosts_backup(backup.name)

    restored = target.read_bytes()
    assert result["ok"] is True
    assert restored == historical


def test_api_rejects_stale_source_hash(tmp_path: Path) -> None:
    paths = app_paths(tmp_path)
    storage = AppStorage(paths)
    storage.ensure_directories()
    target = tmp_path / "hosts"
    target.write_bytes(b"127.0.0.1 localhost\r\n")

    result = DesktopApi(paths, storage, target).apply_hosts(
        {
            "content": "127.0.0.1 localhost\n",
            "sourceSha256": "0" * 64,
            "previewOnly": True,
        }
    )

    assert result["ok"] is False
    assert result["error"]["code"] == "HOSTS_STALE"


def test_api_opens_only_fixed_project_repository(tmp_path: Path, monkeypatch) -> None:
    paths = app_paths(tmp_path)
    storage = AppStorage(paths)
    storage.ensure_directories()
    opened: list[str] = []
    monkeypatch.setattr(
        api_module,
        "open_project_repository",
        lambda: opened.append("https://gitee.com/i-_-kaikai/kaitools") or True,
    )

    result = DesktopApi(paths, storage).open_project_repository()

    assert result == {"ok": True, "data": None}
    assert opened == ["https://gitee.com/i-_-kaikai/kaitools"]


def test_api_reports_project_repository_open_failure(tmp_path: Path, monkeypatch) -> None:
    paths = app_paths(tmp_path)
    storage = AppStorage(paths)
    storage.ensure_directories()
    monkeypatch.setattr(api_module, "open_project_repository", lambda: False)

    result = DesktopApi(paths, storage).open_project_repository()

    assert result["ok"] is False
    assert result["error"]["code"] == "OPEN_EXTERNAL_FAILED"
