from __future__ import annotations

import argparse
import ctypes
import logging
import os
import sys
from pathlib import Path

from .api import DesktopApi
from .clipboard import ClipboardHistoryService
from .document_conversion import execute_conversion_request
from .hotkeys import GlobalActivationHotkey, HotkeyError
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
from .storage import AppStorage, StorageError
from .tray import TrayController, TrayError
from .version import APP_VERSION

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


def _configure_native_window(window: object, tray: TrayController) -> None:
    events = getattr(window, "events", None)
    shown = getattr(events, "shown", None)
    if shown is None or not shown.wait(15):
        LOGGER.warning("dark_title_bar_wait_timeout")
        return
    _apply_dark_title_bar(window)
    try:
        tray.initialize()
    except TrayError as exc:
        LOGGER.exception("tray_initialization_failed")
        raise RuntimeError(str(exc)) from exc


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--apply-hosts-request", nargs=2, metavar=("PATH", "SHA256"))
    parser.add_argument("--document-conversion-request", nargs=2, metavar=("PATH", "SHA256"))
    parser.add_argument("--debug", action="store_true")
    return parser.parse_args()


def _activate_window(window: object) -> None:
    try:
        hwnd = _native_window_handle(window)
        if hwnd:
            user32 = ctypes.windll.user32
            # The hotkey and duplicate-launch paths run off the WebView UI thread.
            # ShowWindowAsync only touches the fixed native window handle, so it does
            # not require executing arbitrary JavaScript or dispatching UI commands.
            user32.ShowWindowAsync(hwnd, 9)  # SW_RESTORE
            user32.ShowWindowAsync(hwnd, 5)  # SW_SHOW
            user32.BringWindowToTop(hwnd)
            user32.SetForegroundWindow(hwnd)
    except Exception:
        LOGGER.exception("window_activation_failed")


def main() -> int:
    args = _arguments()
    paths = resolve_paths()
    document_conversion_request = getattr(args, "document_conversion_request", None)
    if document_conversion_request:
        request_path, expected_sha = document_conversion_request
        return execute_conversion_request(Path(request_path), expected_sha)
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
    activation_hotkey: GlobalActivationHotkey | None = None
    tray: TrayController | None = None
    clipboard: ClipboardHistoryService | None = None
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

        settings = storage.load_all()["settings"]
        clipboard = ClipboardHistoryService()
        clipboard.set_enabled(settings.get("clipboardMonitoringEnabled") is not False)
        clipboard.start()
        api = DesktopApi(paths, storage, clipboard=clipboard)
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
        tray = TrayController(window, _resolve_application_icon(paths))
        activation_hotkey = GlobalActivationHotkey(tray.toggle_for_hotkey)
        try:
            configured_hotkey = settings["activationHotkey"]
            registered_hotkey = activation_hotkey.start(configured_hotkey)
            LOGGER.info("activation_hotkey_registered hotkey=%s", registered_hotkey)
        except (HotkeyError, StorageError) as exc:
            # A conflicting shortcut must not prevent the local-first desktop app from starting.
            LOGGER.warning("activation_hotkey_unavailable reason=%s", exc)
        api.bind_activation_hotkey(activation_hotkey)
        api.bind_window(window)
        api.bind_tray(tray)
        api.bind_clipboard(clipboard)
        instance.listen(tray.show)
        LOGGER.info("application_start version=%s webview2=%s", APP_VERSION, detected_webview2)
        webview.start(
            func=_configure_native_window,
            args=(window, tray),
            gui="edgechromium",
            icon=_resolve_application_icon(paths),
            debug=args.debug,
            http_server=True,
            private_mode=False,
            storage_path=str(paths.webview_profile_dir),
        )
        LOGGER.info("application_stop")
        return 0
    finally:
        if activation_hotkey is not None:
            activation_hotkey.stop()
        if tray is not None:
            tray.dispose()
        if clipboard is not None:
            clipboard.stop()
        instance.close()
