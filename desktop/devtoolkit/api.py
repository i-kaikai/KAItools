from __future__ import annotations

import logging
import time
import webbrowser
from pathlib import Path
from typing import Any

from .elevation import ElevationError, run_elevated_request
from .hosts import (
    HostsError,
    SYSTEM_HOSTS_PATH,
    backup_path,
    decode_hosts_bytes,
    encode_hosts_text,
    list_backups,
    prepare_request,
    read_status,
    sha256_bytes,
)
from .hotkeys import GlobalActivationHotkey, HotkeyError, normalize_activation_hotkey
from .clipboard import ClipboardHistoryService, write_clipboard_text
from .paths import AppPaths
from .runtime import open_desktop_download, open_developer_tools, open_github_repository, open_project_repository, open_webview2_download, webview2_version
from .storage import AppStorage, StorageError
from .tray import TrayController, TrayError
from .system_status import collect_system_status
from .version import APP_VERSION

LOGGER = logging.getLogger(__name__)


def _success(data: Any = None) -> dict[str, Any]:
    return {"ok": True, "data": data}


def _failure(code: str, message: str, details: Any = None) -> dict[str, Any]:
    return {"ok": False, "error": {"code": code, "message": message, "details": details}}


class DesktopApi:
    def __init__(
        self,
        paths: AppPaths,
        storage: AppStorage,
        hosts_path: Path = SYSTEM_HOSTS_PATH,
        activation_hotkey: GlobalActivationHotkey | None = None,
        tray: TrayController | None = None,
        clipboard: ClipboardHistoryService | None = None,
    ) -> None:
        self._paths = paths
        self._storage = storage
        self._hosts_path = hosts_path
        self._activation_hotkey = activation_hotkey
        self._tray = tray
        self._clipboard = clipboard
        self._window: object | None = None

    def bind_window(self, window: object) -> None:
        self._window = window

    def bind_activation_hotkey(self, activation_hotkey: GlobalActivationHotkey) -> None:
        """Attach the process-owned shortcut service after the native window exists."""

        self._activation_hotkey = activation_hotkey

    def bind_tray(self, tray: TrayController) -> None:
        """Attach the one application-owned tray controller after window creation."""

        self._tray = tray

    def bind_clipboard(self, clipboard: ClipboardHistoryService) -> None:
        self._clipboard = clipboard

    def load_state(self) -> dict[str, Any]:
        try:
            state = self._storage.load_all()
            state["runtime"] = {
                "version": APP_VERSION,
                "webview2": webview2_version(),
                "dataDirectory": str(self._paths.data_root),
            }
            return _success(state)
        except StorageError as exc:
            return _failure("STORAGE_READ_FAILED", str(exc))

    def save_settings(self, payload: Any) -> dict[str, Any]:
        started = time.perf_counter()
        try:
            if not isinstance(payload, dict):
                raise StorageError("设置格式无效")
            self._storage.save_settings(payload)
            settings = payload.get("settings")
            if self._clipboard is not None and isinstance(settings, dict) and "clipboardMonitoringEnabled" in settings:
                self._clipboard.set_enabled(settings["clipboardMonitoringEnabled"])
            LOGGER.info("settings_saved duration_ms=%d", (time.perf_counter() - started) * 1000)
            return _success()
        except StorageError as exc:
            return _failure("SETTINGS_SAVE_FAILED", str(exc))

    def set_activation_hotkey(self, hotkey: Any) -> dict[str, Any]:
        """Register one validated global shortcut, then persist it as a device setting."""

        if self._activation_hotkey is None:
            return _failure("HOTKEY_UNAVAILABLE", "全局唤起快捷键仅 Windows 桌面版可用")
        try:
            normalized = normalize_activation_hotkey(hotkey)
            previous = self._storage.load_all()["settings"]["activationHotkey"]
            try:
                self._activation_hotkey.start(normalized)
            except HotkeyError:
                # Registration uses one Win32 identifier, so changing the key requires
                # releasing the old registration first. Restore it when the requested
                # replacement is already owned by another process.
                try:
                    self._activation_hotkey.start(previous)
                except HotkeyError:
                    LOGGER.exception("activation_hotkey_restore_failed")
                raise
            try:
                self._storage.save_settings({"settings": {"activationHotkey": normalized}})
            except StorageError:
                # Keep registration and disk state consistent when an atomic write fails.
                self._activation_hotkey.start(previous)
                raise
            return _success({"activationHotkey": normalized})
        except HotkeyError as exc:
            return _failure("HOTKEY_REGISTRATION_FAILED", str(exc))
        except StorageError as exc:
            return _failure("SETTINGS_SAVE_FAILED", str(exc))

    def hide_to_tray(self) -> dict[str, Any]:
        try:
            if self._tray is None:
                return _failure("TRAY_UNAVAILABLE", "系统托盘尚未就绪")
            self._tray.hide()
            return _success()
        except TrayError as exc:
            LOGGER.exception("hide_to_tray_failed")
            return _failure("TRAY_UNAVAILABLE", str(exc))

    def get_clipboard_history(self) -> dict[str, Any]:
        if self._clipboard is None:
            return _failure("CLIPBOARD_UNAVAILABLE", "剪切板历史服务尚未就绪")
        return _success(self._clipboard.snapshot())

    def clear_clipboard_history(self) -> dict[str, Any]:
        if self._clipboard is None:
            return _failure("CLIPBOARD_UNAVAILABLE", "剪切板历史服务尚未就绪")
        self._clipboard.clear()
        return _success()

    def delete_clipboard_history_item(self, item_id: Any) -> dict[str, Any]:
        if self._clipboard is None:
            return _failure("CLIPBOARD_UNAVAILABLE", "剪切板历史服务尚未就绪")
        if not isinstance(item_id, str) or not 1 <= len(item_id) <= 80:
            return _failure("CLIPBOARD_ITEM_INVALID", "剪切板历史项无效")
        return _success({"removed": self._clipboard.remove(item_id)})

    def set_clipboard_monitoring(self, enabled: Any) -> dict[str, Any]:
        if self._clipboard is None:
            return _failure("CLIPBOARD_UNAVAILABLE", "剪切板历史服务尚未就绪")
        if not isinstance(enabled, bool):
            return _failure("CLIPBOARD_MONITORING_INVALID", "剪切板监控开关无效")
        self._clipboard.set_enabled(enabled)
        try:
            self._storage.save_settings({"settings": {"clipboardMonitoringEnabled": enabled}})
        except StorageError as exc:
            return _failure("SETTINGS_SAVE_FAILED", str(exc))
        return _success({"enabled": enabled})

    def copy_text(self, value: Any) -> dict[str, Any]:
        if not isinstance(value, str) or not value or len(value.encode("utf-8")) > 16 * 1024:
            return _failure("CLIPBOARD_TEXT_INVALID", "复制内容必须为不超过 16KB 的文本")
        if not write_clipboard_text(value):
            return _failure("CLIPBOARD_WRITE_FAILED", "无法写入系统剪切板")
        return _success()

    def get_system_status(self) -> dict[str, Any]:
        try:
            return _success(collect_system_status(self._paths, self._clipboard, self._tray))
        except Exception as exc:
            LOGGER.exception("system_status_read_failed")
            return _failure("SYSTEM_STATUS_FAILED", "无法读取系统状态", str(exc))

    def save_workspace(self, payload: Any) -> dict[str, Any]:
        try:
            if not isinstance(payload, dict):
                raise StorageError("工作台格式无效")
            self._storage.save_workspace(payload)
            LOGGER.info("workspace_saved tabs=%d", len(payload.get("tabs", [])))
            return _success()
        except StorageError as exc:
            return _failure("WORKSPACE_SAVE_FAILED", str(exc))

    def load_notes(self) -> dict[str, Any]:
        try:
            return _success(self._storage.load_notes())
        except StorageError as exc:
            return _failure("NOTES_LOAD_FAILED", str(exc))

    def save_notes(self, payload: Any) -> dict[str, Any]:
        try:
            if not isinstance(payload, dict):
                raise StorageError("笔记格式无效")
            self._storage.save_notes(payload)
            return _success()
        except StorageError as exc:
            return _failure("NOTES_SAVE_FAILED", str(exc))

    def read_hosts(self) -> dict[str, Any]:
        try:
            raw = self._hosts_path.read_bytes()
            content, encoding, newline = decode_hosts_bytes(raw)
            return _success(
                {
                    "path": str(self._hosts_path),
                    "sha256": sha256_bytes(raw),
                    "content": content,
                    "encoding": encoding,
                    "newline": "CRLF" if newline == "\r\n" else "LF",
                    "backups": list_backups(self._paths),
                }
            )
        except (OSError, HostsError) as exc:
            return _failure("HOSTS_READ_FAILED", str(exc))

    def apply_hosts(self, payload: Any) -> dict[str, Any]:
        started = time.perf_counter()
        try:
            if not isinstance(payload, dict) or set(payload) - {"content", "sourceSha256", "previewOnly"}:
                raise HostsError("Hosts 请求格式无效")
            preview_only = payload.get("previewOnly", False)
            if not isinstance(preview_only, bool):
                raise HostsError("Hosts 预览选项无效")
            content = payload.get("content")
            source_sha256 = payload.get("sourceSha256")
            if not isinstance(content, str):
                raise HostsError("Hosts 内容格式无效")
            if (
                not isinstance(source_sha256, str)
                or len(source_sha256) != 64
                or any(character not in "0123456789abcdefABCDEF" for character in source_sha256)
            ):
                raise HostsError("Hosts 源文件摘要无效")
            current = self._hosts_path.read_bytes()
            current_sha256 = sha256_bytes(current)
            if current_sha256.lower() != source_sha256.lower():
                return _failure("HOSTS_STALE", "系统 Hosts 已被其他程序修改，请重新加载后编辑")
            desired = encode_hosts_text(content, current)
            current_content, _, _ = decode_hosts_bytes(current)
            desired_content, _, _ = decode_hosts_bytes(desired)
            preview = {
                "currentContent": current_content,
                "desiredContent": desired_content,
                "changed": current != desired,
                "sourceSha256": current_sha256,
                "desiredSha256": sha256_bytes(desired),
            }
            if preview_only or current == desired:
                return _success(preview)

            request_path, request_sha = prepare_request(
                self._paths, current, desired, "apply", self._hosts_path
            )
            run_elevated_request(request_path, request_sha)
            status = read_status(request_path)
            if not status.get("ok"):
                raise HostsError(str(status.get("message", "Hosts 写入失败")))
            LOGGER.info("hosts_applied duration_ms=%d", (time.perf_counter() - started) * 1000)
            return _success({**preview, "backups": list_backups(self._paths)})
        except ElevationError as exc:
            return _failure("ELEVATION_FAILED", str(exc))
        except (OSError, HostsError, StorageError) as exc:
            return _failure("HOSTS_APPLY_FAILED", str(exc))

    def list_hosts_backups(self) -> dict[str, Any]:
        try:
            return _success(list_backups(self._paths))
        except OSError as exc:
            return _failure("BACKUP_LIST_FAILED", str(exc))

    def restore_hosts_backup(self, backup_id: Any) -> dict[str, Any]:
        started = time.perf_counter()
        try:
            if not isinstance(backup_id, str):
                raise HostsError("备份标识无效")
            current = self._hosts_path.read_bytes()
            desired = backup_path(self._paths, backup_id).read_bytes()
            if desired == current:
                return _success({"changed": False, "backups": list_backups(self._paths)})
            request_path, request_sha = prepare_request(
                self._paths, current, desired, "restore", self._hosts_path
            )
            run_elevated_request(request_path, request_sha)
            status = read_status(request_path)
            if not status.get("ok"):
                raise HostsError(str(status.get("message", "Hosts 恢复失败")))
            LOGGER.info("hosts_restored duration_ms=%d", (time.perf_counter() - started) * 1000)
            return _success({"changed": True, "backups": list_backups(self._paths)})
        except ElevationError as exc:
            return _failure("ELEVATION_FAILED", str(exc))
        except (OSError, HostsError) as exc:
            return _failure("HOSTS_RESTORE_FAILED", str(exc))

    def open_webview2_download(self) -> dict[str, Any]:
        open_webview2_download()
        return _success()

    def open_project_repository(self) -> dict[str, Any]:
        try:
            if not open_project_repository():
                return _failure("OPEN_EXTERNAL_FAILED", "无法使用系统默认浏览器打开 Gitee 仓库")
            return _success()
        except (OSError, webbrowser.Error) as exc:
            return _failure("OPEN_EXTERNAL_FAILED", "无法使用系统默认浏览器打开 Gitee 仓库", str(exc))

    def open_github_repository(self) -> dict[str, Any]:
        try:
            if not open_github_repository():
                return _failure("OPEN_EXTERNAL_FAILED", "无法使用系统默认浏览器打开 GitHub 仓库")
            return _success()
        except (OSError, webbrowser.Error) as exc:
            return _failure("OPEN_EXTERNAL_FAILED", "无法使用系统默认浏览器打开 GitHub 仓库", str(exc))

    def open_desktop_download(self) -> dict[str, Any]:
        try:
            if not open_desktop_download():
                return _failure("OPEN_EXTERNAL_FAILED", "无法使用系统默认浏览器打开桌面版下载页面")
            return _success()
        except (OSError, webbrowser.Error) as exc:
            return _failure("OPEN_EXTERNAL_FAILED", "无法使用系统默认浏览器打开桌面版下载页面", str(exc))

    def open_developer_tools(self) -> dict[str, Any]:
        try:
            settings = self._storage.load_all()["settings"]
            if settings.get("developerModeEnabled") is not True:
                return _failure("DEVELOPER_MODE_REQUIRED", "请先启用开发者模式")
            if self._window is None:
                return _failure("DEVTOOLS_UNAVAILABLE", "WebView2 开发者工具尚未就绪")
            open_developer_tools(self._window)
            return _success()
        except (RuntimeError, StorageError) as exc:
            return _failure("DEVTOOLS_UNAVAILABLE", str(exc))
