from __future__ import annotations

from devtoolkit.clipboard import ClipboardHistoryService
from devtoolkit.paths import AppPaths
import devtoolkit.system_status as system_status
from devtoolkit.system_status import SystemStatusCollector, collect_system_status


def test_system_status_reads_only_controlled_runtime_data(tmp_path, monkeypatch) -> None:
    paths = AppPaths(tmp_path, tmp_path / "resources", tmp_path / "data")
    paths.data_root.mkdir()
    (paths.data_root / "state.json").write_text("{}", encoding="utf-8")
    clipboard = ClipboardHistoryService()
    clipboard._append("local")
    monkeypatch.setattr(system_status, "_cpu_name", lambda: "Test CPU")
    monkeypatch.setattr(system_status, "_power_status", lambda: ("battery", 82, True))

    status = collect_system_status(paths, clipboard, None)

    assert status["runtime"] == "desktop"
    assert status["application"]["dataDirectory"] == str(paths.data_root)
    assert status["application"]["dataDirectoryBytes"] == 2
    assert status["application"]["clipboard"]["count"] == 1
    assert status["system"]["cpuName"] == "Test CPU"
    assert status["system"]["powerSource"] == "battery"
    assert status["system"]["powerPercent"] == 82
    assert status["system"]["powerCharging"] is True


def test_cpu_and_memory_usage_percentages_are_normalized() -> None:
    assert system_status._cpu_usage_percent((100, 1_000), (130, 1_200)) == 85.0
    assert system_status._cpu_usage_percent((100, 1_000), (80, 1_200)) is None
    assert system_status._memory_usage_percent(16_000, 3_424) == 78.6
    assert system_status._memory_usage_percent(None, 3_424) is None


def test_status_collector_caches_expensive_application_diagnostics(tmp_path, monkeypatch) -> None:
    paths = AppPaths(tmp_path, tmp_path / "resources", tmp_path / "data")
    paths.data_root.mkdir()
    calls = {"directory": 0, "webview": 0}
    monkeypatch.setattr(system_status, "_directory_size", lambda _directory: calls.__setitem__("directory", calls["directory"] + 1) or 42)
    monkeypatch.setattr(system_status, "webview2_version", lambda: calls.__setitem__("webview", calls["webview"] + 1) or "Test WebView2")

    collector = SystemStatusCollector(slow_refresh_seconds=30)
    first = collector.collect(paths, None, None)
    second = collector.collect(paths, None, None)

    assert first["application"]["dataDirectoryBytes"] == 42
    assert second["application"]["webview2"] == "Test WebView2"
    assert calls == {"directory": 1, "webview": 1}


def test_power_status_maps_battery_and_external_power_without_hardware_access() -> None:
    assert system_status._parse_power_status(1, 0x08, 82) == ("battery", 82, True)
    assert system_status._parse_power_status(0, 0, 34) == ("battery", 34, False)
    assert system_status._parse_power_status(1, 0x80, 255) == ("external", None, None)
