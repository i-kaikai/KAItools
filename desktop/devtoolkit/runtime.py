from __future__ import annotations

import os
import struct
import sys
import webbrowser
import ctypes
from pathlib import Path

from .paths import AppPaths

WEBVIEW2_DOWNLOAD_URL = "https://developer.microsoft.com/microsoft-edge/webview2/"
WEBVIEW2_CLIENT_ID = "{F3017226-FE2A-4295-8BDF-00C3A19A7C66}"
PROJECT_REPOSITORY_URL = "https://gitee.com/i-_-kaikai/kaitools"
GITHUB_REPOSITORY_URL = "https://github.com/imxukai/KAItools"


def is_supported_windows() -> bool:
    if sys.platform != "win32" or struct.calcsize("P") * 8 != 64:
        return False
    return sys.getwindowsversion().major >= 10


def _webview2_loader_version() -> str | None:
    try:
        import webview

        loader_path = (
            Path(webview.__file__).resolve().parent
            / "lib"
            / "runtimes"
            / "win-x64"
            / "native"
            / "WebView2Loader.dll"
        )
        loader = ctypes.WinDLL(str(loader_path))
        get_version = loader.GetAvailableCoreWebView2BrowserVersionString
        get_version.argtypes = [ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_void_p)]
        get_version.restype = ctypes.c_long
        version_pointer = ctypes.c_void_p()
        result = get_version(None, ctypes.byref(version_pointer))
        if result < 0 or not version_pointer.value:
            return None
        try:
            return ctypes.wstring_at(version_pointer.value)
        finally:
            ctypes.windll.ole32.CoTaskMemFree(version_pointer)
    except (AttributeError, ImportError, OSError):
        return None


def webview2_version() -> str | None:
    if sys.platform != "win32":
        return None
    loader_version = _webview2_loader_version()
    if loader_version:
        return loader_version
    import winreg

    locations = (
        (winreg.HKEY_LOCAL_MACHINE, rf"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_CLIENT_ID}"),
        (winreg.HKEY_LOCAL_MACHINE, rf"SOFTWARE\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_CLIENT_ID}"),
        (winreg.HKEY_CURRENT_USER, rf"Software\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_CLIENT_ID}"),
    )
    for root, subkey in locations:
        try:
            with winreg.OpenKey(root, subkey) as key:
                version, _ = winreg.QueryValueEx(key, "pv")
                if isinstance(version, str) and version:
                    return version
        except OSError:
            continue
    return None


def validate_resources(paths: AppPaths, dev_url: str | None = None) -> None:
    if dev_url:
        return
    index_file = paths.web_root / "index.html"
    if not index_file.is_file():
        raise RuntimeError(f"前端资源缺失：{index_file}")


def open_webview2_download() -> None:
    webbrowser.open(WEBVIEW2_DOWNLOAD_URL)


def open_project_repository() -> bool:
    return bool(webbrowser.open(PROJECT_REPOSITORY_URL))


def open_github_repository() -> bool:
    return bool(webbrowser.open(GITHUB_REPOSITORY_URL))


def show_startup_error(message: str, offer_webview_download: bool = False) -> None:
    if sys.platform != "win32":
        print(message, file=sys.stderr)
        return
    import ctypes

    flags = 0x10
    if offer_webview_download:
        flags |= 0x04
        result = ctypes.windll.user32.MessageBoxW(
            None,
            f"{message}\n\n是否打开 WebView2 官方下载页面？",
            "KAITools 无法启动",
            flags,
        )
        if result == 6:
            open_webview2_download()
    else:
        ctypes.windll.user32.MessageBoxW(
            None, message, "KAITools 无法启动", flags
        )


def resolve_web_entry(paths: AppPaths) -> str:
    dev_url = os.environ.get("DEVTOOLKIT_DEV_URL", "").strip()
    if dev_url:
        return dev_url
    return str((paths.web_root / "index.html").resolve())
