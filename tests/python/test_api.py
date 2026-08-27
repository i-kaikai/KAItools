from __future__ import annotations

from pathlib import Path

import devtoolkit.api as api_module
from devtoolkit.api import DesktopApi
from devtoolkit.hotkeys import HotkeyError
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


def test_api_opens_devtools_only_after_developer_mode_is_enabled(tmp_path: Path, monkeypatch) -> None:
    paths = app_paths(tmp_path)
    storage = AppStorage(paths)
    storage.ensure_directories()
    opened: list[object] = []
    monkeypatch.setattr(api_module, "open_developer_tools", lambda window: opened.append(window))
    desktop_api = DesktopApi(paths, storage)
    window = object()
    desktop_api.bind_window(window)

    denied = desktop_api.open_developer_tools()
    storage.save_settings({"settings": {"developerModeEnabled": True}})
    allowed = desktop_api.open_developer_tools()

    assert denied["ok"] is False
    assert denied["error"]["code"] == "DEVELOPER_MODE_REQUIRED"
    assert allowed == {"ok": True, "data": None}
    assert opened == [window]



def test_api_opens_only_fixed_github_repository(tmp_path: Path, monkeypatch) -> None:
    paths = app_paths(tmp_path)
    storage = AppStorage(paths)
    storage.ensure_directories()
    opened: list[str] = []
    monkeypatch.setattr(
        api_module,
        "open_github_repository",
        lambda: opened.append("https://github.com/i-kaikai/KAItools") or True,
    )

    result = DesktopApi(paths, storage).open_github_repository()

    assert result == {"ok": True, "data": None}
    assert opened == ["https://github.com/i-kaikai/KAItools"]


def test_api_opens_only_fixed_desktop_download(tmp_path: Path, monkeypatch) -> None:
    paths = app_paths(tmp_path)
    storage = AppStorage(paths)
    storage.ensure_directories()
    opened: list[str] = []
    monkeypatch.setattr(
        api_module,
        "open_desktop_download",
        lambda: opened.append("https://gitee.com/i-_-kaikai/kaitools/releases") or True,
    )

    result = DesktopApi(paths, storage).open_desktop_download()

    assert result == {"ok": True, "data": None}
    assert opened == ["https://gitee.com/i-_-kaikai/kaitools/releases"]


def test_api_registers_and_persists_activation_hotkey(tmp_path: Path) -> None:
    class FakeHotkey:
        def __init__(self) -> None:
            self.started: list[str] = []

        def start(self, value: str) -> str:
            self.started.append(value)
            return value

    paths = app_paths(tmp_path)
    storage = AppStorage(paths)
    storage.ensure_directories()
    hotkey = FakeHotkey()
    desktop_api = DesktopApi(paths, storage, activation_hotkey=hotkey)  # type: ignore[arg-type]

    result = desktop_api.set_activation_hotkey("alt+ctrl+shift+f8")

    assert result == {"ok": True, "data": {"activationHotkey": "Ctrl+Alt+Shift+F8"}}
    assert hotkey.started == ["Ctrl+Alt+Shift+F8"]
    assert storage.load_all()["settings"]["activationHotkey"] == "Ctrl+Alt+Shift+F8"


def test_api_keeps_existing_hotkey_when_replacement_is_unavailable(tmp_path: Path) -> None:
    class FailingHotkey:
        def __init__(self) -> None:
            self.started: list[str] = []

        def start(self, value: str) -> str:
            self.started.append(value)
            if value == "Ctrl+Alt+F8":
                raise HotkeyError("该唤起快捷键已被其他应用占用，请更换组合键")
            return value

    paths = app_paths(tmp_path)
    storage = AppStorage(paths)
    storage.ensure_directories()
    hotkey = FailingHotkey()
    desktop_api = DesktopApi(paths, storage, activation_hotkey=hotkey)  # type: ignore[arg-type]

    result = desktop_api.set_activation_hotkey("Ctrl+Alt+F8")

    assert result["ok"] is False
    assert result["error"]["code"] == "HOTKEY_REGISTRATION_FAILED"
    assert hotkey.started == ["Ctrl+Alt+F8", "Ctrl+Alt+K"]
    assert storage.load_all()["settings"]["activationHotkey"] == "Ctrl+Alt+K"


def test_api_hides_only_through_the_bound_tray_controller(tmp_path: Path) -> None:
    class FakeTray:
        def __init__(self) -> None:
            self.hidden = 0

        def hide(self) -> None:
            self.hidden += 1

    paths = app_paths(tmp_path)
    storage = AppStorage(paths)
    storage.ensure_directories()
    tray = FakeTray()
    desktop_api = DesktopApi(paths, storage, tray=tray)  # type: ignore[arg-type]

    assert desktop_api.hide_to_tray() == {"ok": True, "data": None}
    assert tray.hidden == 1


def test_api_uses_only_bound_clipboard_service(tmp_path: Path) -> None:
    class FakeClipboard:
        def __init__(self) -> None:
            self.enabled = True
            self.cleared = 0
            self.copied: list[str] = []

        def snapshot(self):
            return {"enabled": self.enabled, "maxEntries": 100, "maxBytes": 16384, "items": []}

        def clear(self) -> None:
            self.cleared += 1

        def remove(self, item_id: str) -> bool:
            return item_id == "clip-1"

        def set_enabled(self, enabled: bool) -> None:
            self.enabled = enabled

    paths = app_paths(tmp_path)
    storage = AppStorage(paths)
    storage.ensure_directories()
    clipboard = FakeClipboard()
    desktop_api = DesktopApi(paths, storage, clipboard=clipboard)  # type: ignore[arg-type]

    assert desktop_api.get_clipboard_history()["data"]["enabled"] is True
    assert desktop_api.delete_clipboard_history_item("clip-1") == {"ok": True, "data": {"removed": True}}
    assert desktop_api.clear_clipboard_history() == {"ok": True, "data": None}
    assert clipboard.cleared == 1
    assert desktop_api.set_clipboard_monitoring(False) == {"ok": True, "data": {"enabled": False}}
    assert clipboard.enabled is False
