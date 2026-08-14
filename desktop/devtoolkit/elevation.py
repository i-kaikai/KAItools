from __future__ import annotations

import ctypes
import subprocess
import sys
from ctypes import wintypes
from pathlib import Path

SEE_MASK_NOCLOSEPROCESS = 0x00000040
SW_HIDE = 0
WAIT_OBJECT_0 = 0
WAIT_TIMEOUT = 258
WAIT_MILLISECONDS = 5 * 60 * 1000


class ElevationError(RuntimeError):
    pass


class ShellExecuteInfo(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("fMask", wintypes.ULONG),
        ("hwnd", wintypes.HWND),
        ("lpVerb", wintypes.LPCWSTR),
        ("lpFile", wintypes.LPCWSTR),
        ("lpParameters", wintypes.LPCWSTR),
        ("lpDirectory", wintypes.LPCWSTR),
        ("nShow", ctypes.c_int),
        ("hInstApp", wintypes.HINSTANCE),
        ("lpIDList", wintypes.LPVOID),
        ("lpClass", wintypes.LPCWSTR),
        ("hkeyClass", wintypes.HKEY),
        ("dwHotKey", wintypes.DWORD),
        ("hIconOrMonitor", wintypes.HANDLE),
        ("hProcess", wintypes.HANDLE),
    ]


def _command(request_path: Path, expected_sha256: str) -> tuple[str, list[str]]:
    arguments = ["--apply-hosts-request", str(request_path), expected_sha256]
    if getattr(sys, "frozen", False):
        return sys.executable, arguments
    main_script = Path(__file__).resolve().parents[1] / "main.py"
    return sys.executable, [str(main_script), *arguments]


def run_elevated_request(request_path: Path, expected_sha256: str) -> int:
    executable, arguments = _command(request_path, expected_sha256)
    info = ShellExecuteInfo()
    info.cbSize = ctypes.sizeof(info)
    info.fMask = SEE_MASK_NOCLOSEPROCESS
    info.lpVerb = "runas"
    info.lpFile = executable
    info.lpParameters = subprocess.list2cmdline(arguments)
    info.lpDirectory = str(Path(executable).resolve().parent)
    info.nShow = SW_HIDE

    shell_execute = ctypes.windll.shell32.ShellExecuteExW
    shell_execute.argtypes = [ctypes.POINTER(ShellExecuteInfo)]
    shell_execute.restype = wintypes.BOOL
    if not shell_execute(ctypes.byref(info)):
        error_code = ctypes.get_last_error() or ctypes.windll.kernel32.GetLastError()
        if error_code == 1223:
            raise ElevationError("已取消管理员授权")
        raise ElevationError(f"无法启动管理员写入进程（错误 {error_code}）")

    try:
        wait_result = ctypes.windll.kernel32.WaitForSingleObject(
            info.hProcess, WAIT_MILLISECONDS
        )
        if wait_result == WAIT_TIMEOUT:
            raise ElevationError("管理员写入操作超时")
        if wait_result != WAIT_OBJECT_0:
            raise ElevationError("等待管理员写入进程失败")
        exit_code = wintypes.DWORD()
        ctypes.windll.kernel32.GetExitCodeProcess(
            info.hProcess, ctypes.byref(exit_code)
        )
        return int(exit_code.value)
    finally:
        ctypes.windll.kernel32.CloseHandle(info.hProcess)
