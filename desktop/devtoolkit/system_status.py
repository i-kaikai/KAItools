from __future__ import annotations

import ctypes
import os
import platform
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


class _SystemPowerStatus(ctypes.Structure):
    _fields_ = [
        ("ACLineStatus", ctypes.c_ubyte),
        ("BatteryFlag", ctypes.c_ubyte),
        ("BatteryLifePercent", ctypes.c_ubyte),
        ("SystemStatusFlag", ctypes.c_ubyte),
        ("BatteryLifeTime", ctypes.c_ulong),
        ("BatteryFullLifeTime", ctypes.c_ulong),
    ]


def _memory_status() -> tuple[int | None, int | None]:
    try:
        status = _MemoryStatus()
        status.dwLength = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return int(status.ullTotalPhys), int(status.ullAvailPhys)
    except Exception:
        pass
    return None, None


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


def collect_system_status(paths: AppPaths, clipboard: ClipboardHistoryService | None, tray: TrayController | None) -> dict[str, Any]:
    total_memory, available_memory = _memory_status()
    power_source, power_percent, power_charging = _power_status()
    clipboard_status = clipboard.status() if clipboard is not None else {"enabled": False, "count": 0, "maxEntries": 0}
    return {
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "runtime": "desktop",
        "system": {
            "platform": f"Windows {platform.release()} ({platform.version()})",
            "architecture": platform.machine() or "不可用",
            "logicalCores": os.cpu_count(),
            "cpuName": _cpu_name(),
            "memoryTotalBytes": total_memory,
            "memoryAvailableBytes": available_memory,
            "powerSource": power_source,
            "powerPercent": power_percent,
            "powerCharging": power_charging,
        },
        "application": {
            "webview2": webview2_version(),
            "dataDirectory": str(paths.data_root),
            "dataDirectoryBytes": _directory_size(paths.data_root),
            "trayHidden": tray.is_hidden if tray is not None else False,
            "clipboard": clipboard_status,
        },
    }
