from __future__ import annotations

from types import SimpleNamespace

import devtoolkit.application as application
import devtoolkit.runtime as runtime
from devtoolkit.paths import AppPaths


def test_dark_title_bar_applies_native_dwm_colors(monkeypatch) -> None:
    calls: list[tuple[int, int, int]] = []
    monkeypatch.setattr(application, "_native_window_handle", lambda window: 314 if window.title == "KAITools" else 0)
    monkeypatch.setattr(
        application,
        "_set_dwm_attribute",
        lambda hwnd, attribute, value: calls.append((hwnd, attribute, value)) or 0,
    )

    assert application._apply_dark_title_bar(SimpleNamespace(title="KAITools")) is True
    assert calls == [
        (314, 20, 1),
        (314, 34, application._colorref("#242a31")),
        (314, 35, application._colorref("#111418")),
        (314, 36, application._colorref("#f3f6f8")),
    ]


def test_application_icon_prefers_packaged_web_asset(tmp_path) -> None:
    paths = AppPaths(tmp_path, tmp_path / "resources", tmp_path / "data")
    source_icon = tmp_path / "frontend" / "public" / "brand" / application.APP_ICON_NAME
    packaged_icon = paths.web_root / "brand" / application.APP_ICON_NAME
    source_icon.parent.mkdir(parents=True)
    packaged_icon.parent.mkdir(parents=True)
    source_icon.write_bytes(b"source")
    packaged_icon.write_bytes(b"packaged")

    assert application._resolve_application_icon(paths) == str(packaged_icon.resolve())


def test_webview2_version_prefers_official_loader(monkeypatch) -> None:
    monkeypatch.setattr(runtime.sys, "platform", "win32")
    monkeypatch.setattr(runtime, "_webview2_loader_version", lambda: "151.0.0.0")

    assert runtime.webview2_version() == "151.0.0.0"


def test_project_repository_uses_fixed_gitee_url(monkeypatch) -> None:
    opened: list[str] = []
    monkeypatch.setattr(runtime.webbrowser, "open", lambda url: opened.append(url) or True)

    assert runtime.open_project_repository() is True
    assert opened == [runtime.PROJECT_REPOSITORY_URL]
    assert runtime.PROJECT_REPOSITORY_URL == "https://gitee.com/i-_-kaikai/kaitools"


def test_github_repository_uses_fixed_url(monkeypatch) -> None:
    opened: list[str] = []
    monkeypatch.setattr(runtime.webbrowser, "open", lambda url: opened.append(url) or True)

    assert runtime.open_github_repository() is True
    assert opened == [runtime.GITHUB_REPOSITORY_URL]
    assert runtime.GITHUB_REPOSITORY_URL == "https://github.com/i-kaikai/KAItools"


def test_desktop_download_uses_fixed_placeholder_url(monkeypatch) -> None:
    opened: list[str] = []
    monkeypatch.setattr(runtime.webbrowser, "open", lambda url: opened.append(url) or True)

    assert runtime.open_desktop_download() is True
    assert opened == ["https://gitee.com/i-_-kaikai/kaitools/releases"]


def test_missing_webview2_closes_single_instance_lock(tmp_path, monkeypatch) -> None:
    events: list[str] = []
    startup_error: list[tuple[str, bool]] = []

    class FakeInstance:
        def acquire_or_notify(self) -> bool:
            events.append("acquire")
            return True

        def close(self) -> None:
            events.append("close")

    paths = AppPaths(tmp_path, tmp_path / "resources", tmp_path / "data")
    monkeypatch.setattr(
        application,
        "_arguments",
        lambda: SimpleNamespace(apply_hosts_request=None, debug=False),
    )
    monkeypatch.setattr(application, "resolve_paths", lambda: paths)
    monkeypatch.setattr(application, "configure_logging", lambda _paths: None)
    monkeypatch.setattr(application, "is_supported_windows", lambda: True)
    monkeypatch.setattr(application, "SingleInstance", FakeInstance)
    monkeypatch.setattr(
        application,
        "webview2_version",
        lambda: events.append("detect") or None,
    )
    monkeypatch.setattr(
        application,
        "show_startup_error",
        lambda message, offer=False: (startup_error.append((message, offer)), events.append("error")),
    )

    assert application.main() == 3
    assert events == ["acquire", "detect", "error", "close"]
    assert startup_error == [("未检测到 Microsoft Edge WebView2 Runtime。", True)]


def test_second_instance_exits_before_runtime_detection(tmp_path, monkeypatch) -> None:
    events: list[str] = []

    class ExistingInstance:
        def acquire_or_notify(self) -> bool:
            events.append("notify")
            return False

    paths = AppPaths(tmp_path, tmp_path / "resources", tmp_path / "data")
    monkeypatch.setattr(
        application,
        "_arguments",
        lambda: SimpleNamespace(apply_hosts_request=None, debug=False),
    )
    monkeypatch.setattr(application, "resolve_paths", lambda: paths)
    monkeypatch.setattr(application, "configure_logging", lambda _paths: None)
    monkeypatch.setattr(application, "is_supported_windows", lambda: True)
    monkeypatch.setattr(application, "SingleInstance", ExistingInstance)
    monkeypatch.setattr(
        application,
        "webview2_version",
        lambda: events.append("unexpected-detection") or None,
    )

    assert application.main() == 0
    assert events == ["notify"]
