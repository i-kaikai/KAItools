from __future__ import annotations

import argparse
import ctypes
import logging
import os
import sys
from pathlib import Path

from .api import DesktopApi
from .hosts import execute_request
from .logging_config import configure_logging
from .paths import resolve_paths
from .runtime import (
    is_supported_windows,
    resolve_web_entry,
    show_startup_error,
    validate_resources,
    webview2_version,
)
from .single_instance import SingleInstance
from .storage import AppStorage

LOGGER = logging.getLogger(__name__)
APP_TITLE = "KAITools"
APP_ICON_NAME = "kaitools-app-icon.ico"


def _colorref(hex_color: str) -> int:
    value = hex_color.removeprefix("#")
    red, green, blue = (int(value[index : index + 2], 16) for index in (0, 2, 4))
    return red | (green << 8) | (blue << 16)


def _window_handle(title: str) -> int:
    try:
        find_window = ctypes.windll.user32.FindWindowW
        find_window.argtypes = (ctypes.c_wchar_p, ctypes.c_wchar_p)
        find_window.restype = ctypes.c_void_p
        return int(find_window(None, title) or 0)
    except Exception:
        LOGGER.exception("window_handle_lookup_failed")
        return 0


def _native_window_handle(window: object) -> int:
    native = getattr(window, "native", None)
    handle = getattr(native, "Handle", None)
    if handle is not None and hasattr(handle, "ToInt64"):
        return int(handle.ToInt64())
    return _window_handle(str(getattr(window, "title", APP_TITLE)))


def _resolve_application_icon(paths: object) -> str | None:
    web_root = getattr(paths, "web_root")
    application_root = getattr(paths, "application_root")
    candidates = (
        web_root / "brand" / APP_ICON_NAME,
        application_root / "frontend" / "public" / "brand" / APP_ICON_NAME,
    )
    return next((str(path.resolve()) for path in candidates if path.is_file()), None)


def _set_dwm_attribute(hwnd: int, attribute: int, value: int) -> int:
    typed_value = ctypes.c_int(value) if attribute in (19, 20) else ctypes.c_uint32(value)
    function = ctypes.windll.dwmapi.DwmSetWindowAttribute
    function.argtypes = (ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint)
    function.restype = ctypes.c_long
    return int(function(hwnd, attribute, ctypes.byref(typed_value), ctypes.sizeof(typed_value)))


def _apply_dark_title_bar(window: object) -> bool:
    hwnd = _native_window_handle(window)
    if not hwnd:
        LOGGER.warning("dark_title_bar_window_not_found")
        return False
    try:
        dark_result = _set_dwm_attribute(hwnd, 20, 1)
        if dark_result != 0:
            dark_result = _set_dwm_attribute(hwnd, 19, 1)
        _set_dwm_attribute(hwnd, 34, _colorref("#242a31"))
        _set_dwm_attribute(hwnd, 35, _colorref("#111418"))
        _set_dwm_attribute(hwnd, 36, _colorref("#f3f6f8"))
        if dark_result != 0:
            LOGGER.warning("dark_title_bar_unsupported result=%s", dark_result)
        return dark_result == 0
    except Exception:
        LOGGER.exception("dark_title_bar_failed")
        return False


def _configure_native_window(window: object) -> None:
    events = getattr(window, "events", None)
    shown = getattr(events, "shown", None)
    if shown is None or not shown.wait(15):
        LOGGER.warning("dark_title_bar_wait_timeout")
        return
    _apply_dark_title_bar(window)


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--apply-hosts-request", nargs=2, metavar=("PATH", "SHA256"))
    parser.add_argument("--debug", action="store_true")
    return parser.parse_args()


def _activate_window(window: object) -> None:
    try:
        window.restore()  # type: ignore[attr-defined]
        window.show()  # type: ignore[attr-defined]
        hwnd = ctypes.windll.user32.FindWindowW(None, APP_TITLE)
        if hwnd:
            ctypes.windll.user32.SetForegroundWindow(hwnd)
    except Exception:
        LOGGER.exception("window_activation_failed")


def main() -> int:
    args = _arguments()
    paths = resolve_paths()
    storage = AppStorage(paths)
    storage.ensure_directories()
    configure_logging(paths)

    if args.apply_hosts_request:
        request_path, expected_sha = args.apply_hosts_request
        return execute_request(Path(request_path), expected_sha, paths)

    if not is_supported_windows():
        show_startup_error("KAITools 仅支持 Windows 10/11 64 位系统。")
        return 2

    instance = SingleInstance()
    if not instance.acquire_or_notify():
        return 0
    try:
        detected_webview2 = webview2_version()
        if not detected_webview2:
            show_startup_error("未检测到 Microsoft Edge WebView2 Runtime。", True)
            return 3

        dev_url = os.environ.get("DEVTOOLKIT_DEV_URL", "").strip() or None
        try:
            validate_resources(paths, dev_url)
        except RuntimeError as exc:
            LOGGER.exception("resource_validation_failed")
            show_startup_error(str(exc))
            return 4

        import webview

        api = DesktopApi(paths, storage)
        window = webview.create_window(
            APP_TITLE,
            resolve_web_entry(paths),
            js_api=api,
            width=1280,
            height=800,
            min_size=(960, 640),
            resizable=True,
            background_color="#05070a",
            text_select=True,
        )
        instance.listen(lambda: _activate_window(window))
        LOGGER.info("application_start version=0.1.0 webview2=%s", detected_webview2)
        webview.start(
            func=_configure_native_window,
            args=(window,),
            gui="edgechromium",
            icon=_resolve_application_icon(paths),
            debug=args.debug,
            http_server=True,
            private_mode=False,
        )
        LOGGER.info("application_stop")
        return 0
    finally:
        instance.close()
