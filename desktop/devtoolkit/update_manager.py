from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .paths import AppPaths
from .update_security import (
    PRODUCT_NAME,
    UpdateSecurityError,
    decode_signature,
    load_public_key,
    normalize_relative_path,
    require_sha256,
    safe_target,
    sha256_bytes,
    sha256_file,
    verify_json,
)
from .version import APP_VERSION

LOGGER = logging.getLogger(__name__)
UPDATE_SCHEMA_VERSION = 1
MAX_OBJECT_BYTES = 2 * 1024 * 1024 * 1024
DOWNLOAD_TIMEOUT_SECONDS = 30


class UpdateError(RuntimeError):
    def __init__(self, code: str, message: str, details: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.details = details


@dataclass(frozen=True)
class UpdateFile:
    path: str
    sha256: str
    size: int
    url: str


@dataclass(frozen=True)
class UpdatePlan:
    version: str
    release_notes: tuple[str, ...]
    published_at: str | None
    files: tuple[UpdateFile, ...]
    delete_paths: tuple[str, ...]
    manifest: dict[str, Any]
    manifest_bytes: bytes
    changed_files: tuple[UpdateFile, ...]
    status: str

    @property
    def download_bytes(self) -> int:
        return sum(item.size for item in self.changed_files)


def _version_parts(value: Any) -> tuple[int, int, int]:
    if not isinstance(value, str):
        raise UpdateSecurityError("版本号无效")
    parts = value.split(".")
    if len(parts) != 3 or any(not part.isdigit() for part in parts):
        raise UpdateSecurityError("版本号必须使用 x.y.z 格式")
    result = tuple(int(part) for part in parts)
    if any(part > 2_147_483_647 for part in result):
        raise UpdateSecurityError("版本号超出允许范围")
    return result  # type: ignore[return-value]


def _read_json(raw: bytes, label: str) -> dict[str, Any]:
    preview = raw.lstrip()[:128].lower()
    if preview.startswith(b"<!doctype html") or preview.startswith(b"<html"):
        raise UpdateSecurityError(f"{label} 返回了 HTML，服务器可能将更新地址回退到了 index.html")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise UpdateSecurityError(f"{label} 不是有效 JSON") from exc
    if not isinstance(value, dict):
        raise UpdateSecurityError(f"{label} 格式无效")
    return value


class UpdateManager:
    """Reads signed static metadata and synchronizes only differing program files."""

    def __init__(
        self,
        paths: AppPaths,
        *,
        urlopen: Callable[..., Any] = urllib.request.urlopen,
        process_launcher: Callable[..., Any] = subprocess.Popen,
    ) -> None:
        self._paths = paths
        self._urlopen = urlopen
        self._process_launcher = process_launcher
        self._progress_lock = threading.RLock()
        self._progress: dict[str, Any] = self._empty_progress()
        self._install_thread: threading.Thread | None = None
        self._pending_install: dict[str, Any] | None = None

    @staticmethod
    def _empty_progress() -> dict[str, Any]:
        return {
            "state": "idle",
            "currentVersion": APP_VERSION,
            "targetVersion": None,
            "currentFile": None,
            "completedFiles": 0,
            "totalFiles": 0,
            "downloadedBytes": 0,
            "totalBytes": 0,
            "error": None,
        }

    def progress(self) -> dict[str, Any]:
        with self._progress_lock:
            return dict(self._progress)

    def _set_progress(self, **values: Any) -> None:
        with self._progress_lock:
            self._progress.update(values)

    def check(self) -> dict[str, Any]:
        try:
            plan = self._build_plan()
            return {
                "currentVersion": APP_VERSION,
                "latestVersion": plan.version,
                "status": plan.status,
                "available": plan.status in {"update-available", "repair-available"},
                "filesToDownload": len(plan.changed_files),
                "bytesToDownload": plan.download_bytes,
                "releaseNotes": list(plan.release_notes),
                "publishedAt": plan.published_at,
                "lastInstallError": self._last_install_error(),
            }
        except UpdateError:
            raise
        except UpdateSecurityError as exc:
            raise UpdateError("UPDATE_METADATA_INVALID", str(exc)) from exc
        except (OSError, urllib.error.URLError, TimeoutError) as exc:
            raise UpdateError("UPDATE_CHECK_FAILED", "无法检查更新，请检查网络后重试", str(exc)) from exc

    def check_latest(self) -> dict[str, Any]:
        """Check only signed version metadata; local files are intentionally untouched."""

        try:
            policy = self._load_policy()
            latest_url = policy["latestUrl"]
            latest = _read_json(self._fetch(latest_url, 128 * 1024), "最新版本清单")
            self._verify_signed(latest, latest_url + ".sig")
            self._validate_latest(latest)
            available = _version_parts(latest["version"]) > _version_parts(APP_VERSION)
            return {
                "currentVersion": APP_VERSION,
                "latestVersion": latest["version"],
                "available": available,
                "releaseNotes": list(latest["releaseNotes"]),
                "publishedAt": latest["publishedAt"],
            }
        except UpdateError:
            raise
        except UpdateSecurityError as exc:
            raise UpdateError("UPDATE_METADATA_INVALID", str(exc)) from exc
        except (OSError, urllib.error.URLError, TimeoutError) as exc:
            raise UpdateError("UPDATE_CHECK_FAILED", "无法检查更新，请检查网络后重试", str(exc)) from exc

    def start_install(self) -> dict[str, Any]:
        with self._progress_lock:
            state = self._progress["state"]
            if state in {"checking", "downloading", "ready-to-restart", "restarting"}:
                return {
                    "version": self._progress["targetVersion"] or "",
                    "restarting": state == "restarting",
                    "filesToDownload": self._progress["totalFiles"],
                    "state": state,
                }
            self._progress = self._empty_progress()
            self._progress["state"] = "checking"
            self._install_thread = threading.Thread(target=self._prepare_install, name="kaitools-update", daemon=True)
            self._install_thread.start()
        return {"version": "", "restarting": False, "filesToDownload": 0, "state": "checking"}

    def restart_install(self) -> dict[str, Any]:
        with self._progress_lock:
            pending = self._pending_install
            if self._progress["state"] != "ready-to-restart" or pending is None:
                raise UpdateError("UPDATE_NOT_READY", "更新文件尚未准备完成")
            self._process_launcher(
                [str(pending["updater"]), "--request", str(pending["request"]), "--request-sha256", pending["requestSha256"]],
                cwd=str(pending["root"]),
                close_fds=True,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            self._progress["state"] = "restarting"
            self._progress["currentFile"] = None
            return {
                "version": self._progress["targetVersion"],
                "restarting": True,
                "filesToDownload": self._progress["totalFiles"],
                "state": "restarting",
            }

    def _prepare_install(self) -> None:
        pending: Path | None = None
        try:
            plan = self._build_plan()
            if plan.status not in {"update-available", "repair-available"}:
                raise UpdateError("UPDATE_NOT_REQUIRED", "当前应用无需更新")
            updater = self._paths.application_root / "KAIToolsUpdater.exe"
            if not updater.is_file():
                raise UpdateError("UPDATER_UNAVAILABLE", "当前版本不包含应用更新器，请手动安装一次最新版")
            required = plan.download_bytes + sum(self._existing_size(item.path) for item in plan.changed_files)
            if shutil.disk_usage(self._paths.data_root).free < required + 32 * 1024 * 1024:
                raise UpdateError("UPDATE_DISK_SPACE", "磁盘可用空间不足，无法准备更新")
            self._set_progress(
                state="downloading",
                targetVersion=plan.version,
                currentFile=None,
                completedFiles=0,
                totalFiles=len(plan.changed_files),
                downloadedBytes=0,
                totalBytes=plan.download_bytes,
                error=None,
            )
            pending = self._paths.pending_dir / "updates" / uuid.uuid4().hex
            staging = pending / "staging"
            staging.mkdir(parents=True, exist_ok=False)
            downloaded_before = 0
            for index, item in enumerate(plan.changed_files):
                self._download_object(
                    item,
                    staging,
                    lambda received, file=item.path, base=downloaded_before: self._set_progress(
                        currentFile=file,
                        downloadedBytes=base + received,
                    ),
                )
                downloaded_before += item.size
                self._set_progress(completedFiles=index + 1, downloadedBytes=downloaded_before, currentFile=item.path)
            manifest_path = staging / "app-manifest.json"
            self._atomic_write(manifest_path, plan.manifest_bytes)
            manifest_file = UpdateFile("app-manifest.json", sha256_bytes(plan.manifest_bytes), len(plan.manifest_bytes), "")
            request = {
                "schemaVersion": UPDATE_SCHEMA_VERSION,
                "applicationRoot": str(self._paths.application_root.resolve()),
                "dataRoot": str(self._paths.data_root.resolve()),
                "mainExecutable": "KAITools.exe",
                "targetVersion": plan.version,
                "parentPid": os.getpid(),
                "stagingRoot": str(staging.resolve()),
                "healthPath": str((pending / "health.json").resolve()),
                "resultPath": str((self._paths.pending_dir / "update-last-result.json").resolve()),
                "files": [self._request_file(item) for item in (*plan.changed_files, manifest_file)],
                "deletePaths": list(plan.delete_paths),
            }
            request_path = pending / "update-request.json"
            request_bytes = json.dumps(request, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
            self._atomic_write(request_path, request_bytes)
            updater_copy = pending / "KAIToolsUpdater.exe"
            shutil.copy2(updater, updater_copy)
            with self._progress_lock:
                self._pending_install = {"root": pending, "request": request_path, "requestSha256": sha256_bytes(request_bytes), "updater": updater_copy}
            self._set_progress(state="ready-to-restart", currentFile=None, downloadedBytes=plan.download_bytes)
            LOGGER.info("update_ready_for_restart target_version=%s files=%d", plan.version, len(plan.changed_files))
        except Exception as exc:
            if pending is not None:
                shutil.rmtree(pending, ignore_errors=True)
            message = str(exc)
            if isinstance(exc, UpdateSecurityError):
                message = str(exc)
            self._set_progress(state="failed", currentFile=None, error=message)
            LOGGER.exception("update_prepare_failed")

    def _build_plan(self) -> UpdatePlan:
        policy = self._load_policy()
        latest_url = policy["latestUrl"]
        latest_raw = self._fetch(latest_url, 128 * 1024)
        latest = _read_json(latest_raw, "最新版本清单")
        self._verify_signed(latest, latest_url + ".sig")
        self._validate_latest(latest)
        manifest_url = self._resolve_static_url(latest["manifest"], latest_url)
        manifest_raw = self._fetch(manifest_url, 8 * 1024 * 1024)
        if sha256_bytes(manifest_raw) != latest["manifestSha256"]:
            raise UpdateSecurityError("版本清单摘要不匹配")
        manifest = _read_json(manifest_raw, "版本文件清单")
        self._verify_signed(manifest, manifest_url + ".sig")
        if manifest.get("version") != latest["version"]:
            raise UpdateSecurityError("版本文件清单版本不匹配")
        files = self._validate_manifest(manifest, latest_url)
        target_version = latest["version"]
        current_parts = _version_parts(APP_VERSION)
        target_parts = _version_parts(target_version)
        if target_parts < current_parts:
            return UpdatePlan(target_version, (), None, files, (), manifest, manifest_raw, (), "newer-local-version")
        changed = tuple(item for item in files if self._existing_digest(item.path) != item.sha256)
        delete_paths = self._managed_extra_paths({item.path for item in files})
        manifest_changed = self._existing_digest("app-manifest.json") != sha256_bytes(manifest_raw)
        if target_parts > current_parts:
            status = "update-available"
        elif changed or delete_paths or manifest_changed:
            status = "repair-available"
        else:
            status = "up-to-date"
        notes = latest.get("releaseNotes", [])
        published_at = latest.get("publishedAt")
        return UpdatePlan(
            target_version,
            tuple(notes),
            published_at if isinstance(published_at, str) else None,
            files,
            delete_paths,
            manifest,
            manifest_raw,
            changed,
            status,
        )

    def _load_policy(self) -> dict[str, str]:
        try:
            raw = self._paths.update_policy_file.read_bytes()
        except OSError as exc:
            raise UpdateError("UPDATE_POLICY_UNAVAILABLE", "应用更新策略不可用", str(exc)) from exc
        policy = _read_json(raw, "更新策略")
        if set(policy) != {"schemaVersion", "product", "channel", "mode", "latestUrl"}:
            raise UpdateSecurityError("更新策略字段无效")
        if (
            policy["schemaVersion"] != UPDATE_SCHEMA_VERSION
            or policy["product"] != PRODUCT_NAME
            or policy["mode"] != "file-sync"
            or not isinstance(policy["channel"], str)
            or not policy["channel"].strip()
        ):
            raise UpdateSecurityError("更新策略不受支持")
        latest_url = policy["latestUrl"]
        if not isinstance(latest_url, str):
            raise UpdateSecurityError("更新地址无效")
        parsed = urllib.parse.urlsplit(latest_url)
        if parsed.scheme != "https" or not parsed.netloc or parsed.query or parsed.fragment:
            raise UpdateSecurityError("更新地址必须是固定 HTTPS 地址")
        return {"latestUrl": latest_url}

    def _verify_signed(self, document: dict[str, Any], signature_url: str) -> None:
        signature = decode_signature(self._fetch(signature_url, 512))
        verify_json(document, signature, load_public_key(self._paths.update_public_key_file))

    def _validate_latest(self, latest: dict[str, Any]) -> None:
        expected = {"schemaVersion", "product", "channel", "version", "manifest", "manifestSha256", "publishedAt", "releaseNotes", "mandatory"}
        if set(latest) != expected or latest["schemaVersion"] != UPDATE_SCHEMA_VERSION or latest["product"] != PRODUCT_NAME:
            raise UpdateSecurityError("最新版本清单字段无效")
        _version_parts(latest["version"])
        require_sha256(latest["manifestSha256"], "版本清单 SHA-256")
        if not isinstance(latest["manifest"], str) or not isinstance(latest["channel"], str) or not isinstance(latest["mandatory"], bool):
            raise UpdateSecurityError("最新版本清单格式无效")
        if latest["publishedAt"] is not None and not isinstance(latest["publishedAt"], str):
            raise UpdateSecurityError("发布日期格式无效")
        if not isinstance(latest["releaseNotes"], list) or any(not isinstance(item, str) or not item.strip() or len(item) > 500 for item in latest["releaseNotes"]):
            raise UpdateSecurityError("更新说明格式无效")

    def _validate_manifest(self, manifest: dict[str, Any], latest_url: str) -> tuple[UpdateFile, ...]:
        expected = {"schemaVersion", "product", "version", "files"}
        if set(manifest) != expected or manifest["schemaVersion"] != UPDATE_SCHEMA_VERSION or manifest["product"] != PRODUCT_NAME:
            raise UpdateSecurityError("版本文件清单字段无效")
        _version_parts(manifest["version"])
        raw_files = manifest["files"]
        if not isinstance(raw_files, list) or not raw_files:
            raise UpdateSecurityError("版本文件清单不能为空")
        files: list[UpdateFile] = []
        seen: set[str] = set()
        for raw in raw_files:
            if not isinstance(raw, dict) or set(raw) != {"path", "sha256", "size", "object"}:
                raise UpdateSecurityError("更新文件条目无效")
            path = normalize_relative_path(raw["path"])
            if path in seen:
                raise UpdateSecurityError("更新文件路径重复")
            seen.add(path)
            digest = require_sha256(raw["sha256"])
            size = raw["size"]
            if not isinstance(size, int) or isinstance(size, bool) or not 0 < size <= MAX_OBJECT_BYTES:
                raise UpdateSecurityError(f"更新文件大小无效: {path}")
            url = self._resolve_static_url(raw["object"], latest_url)
            files.append(UpdateFile(path, digest, size, url))
        return tuple(files)

    def _resolve_static_url(self, relative: Any, latest_url: str) -> str:
        if not isinstance(relative, str) or not relative or relative.startswith("/") or ":" in relative or "\\" in relative:
            raise UpdateSecurityError("更新资源地址无效")
        base = urllib.parse.urlsplit(latest_url)
        resolved = urllib.parse.urlsplit(urllib.parse.urljoin(latest_url, relative))
        if resolved.scheme != "https" or resolved.netloc != base.netloc or resolved.query or resolved.fragment:
            raise UpdateSecurityError("更新资源地址不受信任")
        base_path = base.path.rsplit("/", 1)[0] + "/"
        if not resolved.path.startswith(base_path):
            raise UpdateSecurityError("更新资源地址超出发布目录")
        return urllib.parse.urlunsplit((resolved.scheme, resolved.netloc, resolved.path, "", ""))

    def _fetch(self, url: str, maximum: int) -> bytes:
        request = urllib.request.Request(url, headers={"User-Agent": "KAITools-Updater/1"})
        with self._urlopen(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
            data = response.read(maximum + 1)
        if len(data) > maximum:
            raise UpdateSecurityError("更新资源超过允许大小")
        return data

    def _existing_digest(self, relative_path: str) -> str | None:
        path = safe_target(self._paths.application_root, relative_path)
        return sha256_file(path) if path.is_file() else None

    def _existing_size(self, relative_path: str) -> int:
        path = safe_target(self._paths.application_root, relative_path)
        return path.stat().st_size if path.is_file() else 0

    def _managed_extra_paths(self, target_paths: set[str]) -> tuple[str, ...]:
        local = self._paths.application_root / "app-manifest.json"
        try:
            manifest = _read_json(local.read_bytes(), "本地程序清单")
            files = self._validate_manifest(manifest, self._load_policy()["latestUrl"])
        except (OSError, UpdateSecurityError, UpdateError):
            return ()
        return tuple(item.path for item in files if item.path not in target_paths and safe_target(self._paths.application_root, item.path).exists())

    def _download_object(self, item: UpdateFile, staging: Path, progress: Callable[[int], None] | None = None) -> None:
        destination = safe_target(staging, item.path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".part")
        request = urllib.request.Request(item.url, headers={"User-Agent": "KAITools-Updater/1"})
        digest = hashlib.sha256()
        received = 0
        try:
            with self._urlopen(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response, temporary.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    received += len(chunk)
                    if received > item.size:
                        raise UpdateSecurityError(f"更新文件大小超出清单: {item.path}")
                    digest.update(chunk)
                    output.write(chunk)
                    if progress is not None:
                        progress(received)
            if received != item.size or digest.hexdigest() != item.sha256:
                raise UpdateSecurityError(f"更新文件摘要不匹配: {item.path}")
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)

    @staticmethod
    def _request_file(item: UpdateFile) -> dict[str, Any]:
        return {"path": item.path, "sha256": item.sha256, "size": item.size}

    @staticmethod
    def _atomic_write(path: Path, content: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(content)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary_name, path)
        finally:
            Path(temporary_name).unlink(missing_ok=True)

    def _last_install_error(self) -> str | None:
        path = self._paths.pending_dir / "update-last-result.json"
        try:
            result = _read_json(path.read_bytes(), "上次更新结果")
        except (OSError, UpdateSecurityError):
            return None
        if result.get("ok") is False and isinstance(result.get("message"), str):
            return result["message"]
        return None
