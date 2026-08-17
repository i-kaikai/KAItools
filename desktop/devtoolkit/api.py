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
from .paths import AppPaths
from .runtime import open_project_repository, open_webview2_download, webview2_version
from .storage import AppStorage, StorageError

LOGGER = logging.getLogger(__name__)


def _success(data: Any = None) -> dict[str, Any]:
    return {"ok": True, "data": data}


def _failure(code: str, message: str, details: Any = None) -> dict[str, Any]:
    return {"ok": False, "error": {"code": code, "message": message, "details": details}}


class DesktopApi:
    def __init__(self, paths: AppPaths, storage: AppStorage, hosts_path: Path = SYSTEM_HOSTS_PATH) -> None:
        self._paths = paths
        self._storage = storage
        self._hosts_path = hosts_path

    def load_state(self) -> dict[str, Any]:
        try:
            state = self._storage.load_all()
            state["runtime"] = {
                "version": "0.1.0",
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
            LOGGER.info("settings_saved duration_ms=%d", (time.perf_counter() - started) * 1000)
            return _success()
        except StorageError as exc:
            return _failure("SETTINGS_SAVE_FAILED", str(exc))

    def save_workspace(self, payload: Any) -> dict[str, Any]:
        try:
            if not isinstance(payload, dict):
                raise StorageError("工作台格式无效")
            self._storage.save_workspace(payload)
            LOGGER.info("workspace_saved tabs=%d", len(payload.get("tabs", [])))
            return _success()
        except StorageError as exc:
            return _failure("WORKSPACE_SAVE_FAILED", str(exc))

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
