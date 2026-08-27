from __future__ import annotations

from devtoolkit.clipboard import ClipboardHistoryService
from devtoolkit.paths import AppPaths
import devtoolkit.system_status as system_status
from devtoolkit.system_status import collect_system_status


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


def test_power_status_maps_battery_and_external_power_without_hardware_access() -> None:
    assert system_status._parse_power_status(1, 0x08, 82) == ("battery", 82, True)
    assert system_status._parse_power_status(0, 0, 34) == ("battery", 34, False)
    assert system_status._parse_power_status(1, 0x80, 255) == ("external", None, None)
