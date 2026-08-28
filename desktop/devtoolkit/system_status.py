from __future__ import annotations

import ctypes
import copy
import os
import platform
import threading
import time
from pathlib import Path
from typing import Any

from .clipboard import ClipboardHistoryService
from .paths import AppPaths
from .runtime import webview2_version
from .tray import TrayController


class _MemoryStatus(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_ulong),
        ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]


class _FileTime(ctypes.Structure):
    _fields_ = [("dwLowDateTime", ctypes.c_uint32), ("dwHighDateTime", ctypes.c_uint32)]


class _SystemPowerStatus(ctypes.Structure):
    _fields_ = [
        ("ACLineStatus", ctypes.c_ubyte),
        ("BatteryFlag", ctypes.c_ubyte),
        ("BatteryLifePercent", ctypes.c_ubyte),
        ("SystemStatusFlag", ctypes.c_ubyte),
        ("BatteryLifeTime", ctypes.c_ulong),
        ("BatteryFullLifeTime", ctypes.c_ulong),
    ]


SLOW_STATUS_REFRESH_SECONDS = 30.0


def _memory_status() -> tuple[int | None, int | None]:
    try:
        status = _MemoryStatus()
        status.dwLength = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return int(status.ullTotalPhys), int(status.ullAvailPhys)
    except Exception:
        pass
    return None, None


def _memory_usage_percent(total_bytes: int | None, available_bytes: int | None) -> float | None:
    if not isinstance(total_bytes, int) or not isinstance(available_bytes, int) or total_bytes <= 0:
        return None
    used_bytes = max(0, min(total_bytes, total_bytes - available_bytes))
    return round(used_bytes / total_bytes * 100, 1)


def _file_time_value(value: _FileTime) -> int:
    return (int(value.dwHighDateTime) << 32) | int(value.dwLowDateTime)


def _cpu_times() -> tuple[int, int] | None:
    """Return cumulative idle and total processor time ticks from the Windows kernel."""

    if os.name != "nt":
        return None
    try:
        idle = _FileTime()
        kernel = _FileTime()
        user = _FileTime()
        if not ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
            return None
        idle_ticks = _file_time_value(idle)
        total_ticks = _file_time_value(kernel) + _file_time_value(user)
        return idle_ticks, total_ticks
    except Exception:
        return None


def _cpu_usage_percent(previous: tuple[int, int] | None, current: tuple[int, int] | None) -> float | None:
    if previous is None or current is None:
        return None
    idle_delta = current[0] - previous[0]
    total_delta = current[1] - previous[1]
    if total_delta <= 0 or idle_delta < 0:
        return None
    return round(max(0.0, min(100.0, (total_delta - idle_delta) / total_delta * 100)), 1)


def _cpu_name() -> str | None:
    """Read the processor marketing name from the Windows hardware registry."""

    if os.name != "nt":
        return None
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0") as key:
            name, _ = winreg.QueryValueEx(key, "ProcessorNameString")
        return name.strip() if isinstance(name, str) and name.strip() else None
    except OSError:
        return None


def _parse_power_status(ac_line_status: int, battery_flag: int, battery_life_percent: int) -> tuple[str, int | None, bool | None]:
    """Normalize Win32 power bytes into a UI-safe source, percentage, and charging state."""

    battery_present = not bool(battery_flag & 0x80)
    if not battery_present:
        return ("external", None, None) if ac_line_status == 1 else ("unavailable", None, None)

    percent = None if battery_life_percent == 255 else battery_life_percent
    charging = ac_line_status == 1 and bool(battery_flag & 0x08)
    return "battery", percent, charging


def _power_status() -> tuple[str, int | None, bool | None]:
    """Return the power source, battery percentage, and charging flag without retaining device data."""

    if os.name != "nt":
        return "unavailable", None, None
    try:
        status = _SystemPowerStatus()
        if not ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(status)):
            return "unavailable", None, None
        return _parse_power_status(status.ACLineStatus, status.BatteryFlag, status.BatteryLifePercent)
    except Exception:
        return "unavailable", None, None


def _directory_size(directory: Path) -> int:
    total = 0
    try:
        for path in directory.rglob("*"):
            if path.is_file():
                total += path.stat().st_size
    except OSError:
        return total
    return total


class SystemStatusCollector:
    """Sample fast host metrics frequently while caching file-system diagnostics."""

    def __init__(self, slow_refresh_seconds: float = SLOW_STATUS_REFRESH_SECONDS) -> None:
        self._slow_refresh_seconds = slow_refresh_seconds
        self._lock = threading.Lock()
        self._previous_cpu_times = _cpu_times()
        self._application_status: dict[str, Any] | None = None
        self._application_status_at = float("-inf")

    def _read_cpu_usage_percent(self) -> float | None:
        current = _cpu_times()
        with self._lock:
            previous = self._previous_cpu_times
            self._previous_cpu_times = current
        return _cpu_usage_percent(previous, current)

    def _read_application_status(
        self,
        paths: AppPaths,
        clipboard: ClipboardHistoryService | None,
        tray: TrayController | None,
    ) -> dict[str, Any]:
        now = time.monotonic()
        with self._lock:
            cached = self._application_status
            if cached is not None and now - self._application_status_at < self._slow_refresh_seconds:
                return copy.deepcopy(cached)

        clipboard_status = clipboard.status() if clipboard is not None else {"enabled": False, "count": 0, "maxEntries": 0}
        fresh = {
            "webview2": webview2_version(),
            "dataDirectory": str(paths.data_root),
            "dataDirectoryBytes": _directory_size(paths.data_root),
            "trayHidden": tray.is_hidden if tray is not None else False,
            "clipboard": clipboard_status,
        }
        with self._lock:
            self._application_status = fresh
            self._application_status_at = now
        return copy.deepcopy(fresh)

    def collect(
        self,
        paths: AppPaths,
        clipboard: ClipboardHistoryService | None,
        tray: TrayController | None,
    ) -> dict[str, Any]:
        total_memory, available_memory = _memory_status()
        power_source, power_percent, power_charging = _power_status()
        return {
            "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "runtime": "desktop",
            "system": {
                "platform": f"Windows {platform.release()} ({platform.version()})",
                "architecture": platform.machine() or "不可用",
                "logicalCores": os.cpu_count(),
                "cpuName": _cpu_name(),
                "cpuUsagePercent": self._read_cpu_usage_percent(),
                "memoryTotalBytes": total_memory,
                "memoryAvailableBytes": available_memory,
                "memoryUsagePercent": _memory_usage_percent(total_memory, available_memory),
                "powerSource": power_source,
                "powerPercent": power_percent,
                "powerCharging": power_charging,
            },
            "application": self._read_application_status(paths, clipboard, tray),
        }


def collect_system_status(
    paths: AppPaths,
    clipboard: ClipboardHistoryService | None,
    tray: TrayController | None,
    collector: SystemStatusCollector | None = None,
) -> dict[str, Any]:
    """Keep the stateless test helper while allowing DesktopApi to reuse one sampler."""

    return (collector or SystemStatusCollector()).collect(paths, clipboard, tray)
