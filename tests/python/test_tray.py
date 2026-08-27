from __future__ import annotations

from types import SimpleNamespace

import devtoolkit.tray as tray_module
from devtoolkit.tray import TrayController


def test_hotkey_hides_only_when_the_application_is_foreground(monkeypatch) -> None:
    tray = TrayController(SimpleNamespace(native=SimpleNamespace(Handle=SimpleNamespace(ToInt64=lambda: 73))), "icon.ico")
    calls: list[str] = []
    monkeypatch.setattr(tray, "hide", lambda: calls.append("hide"))
    monkeypatch.setattr(tray, "show", lambda: calls.append("show"))
    monkeypatch.setattr(TrayController, "is_hidden", property(lambda _self: False))
    monkeypatch.setattr(tray_module.ctypes.windll.user32, "GetForegroundWindow", lambda: 73)

    tray.toggle_for_hotkey()

    assert calls == ["hide"]


def test_hotkey_restores_hidden_or_background_application(monkeypatch) -> None:
    tray = TrayController(SimpleNamespace(native=SimpleNamespace(Handle=SimpleNamespace(ToInt64=lambda: 73))), "icon.ico")
    calls: list[str] = []
    monkeypatch.setattr(tray, "hide", lambda: calls.append("hide"))
    monkeypatch.setattr(tray, "show", lambda: calls.append("show"))
    monkeypatch.setattr(TrayController, "is_hidden", property(lambda _self: True))

    tray.toggle_for_hotkey()

    assert calls == ["show"]
