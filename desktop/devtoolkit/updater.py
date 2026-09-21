from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from .update_security import UpdateSecurityError, normalize_relative_path, require_sha256, safe_target, sha256_bytes, sha256_file

HEALTH_TIMEOUT_SECONDS = 45
WAIT_PARENT_SECONDS = 30
REQUEST_SCHEMA_VERSION = 1


class UpdaterError(RuntimeError):
    pass


def _read_request(path: Path, expected_sha256: str) -> dict[str, Any]:
    raw = path.read_bytes()
    if sha256_bytes(raw) != expected_sha256:
        raise UpdaterError("更新请求摘要不匹配")
    try:
        request = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise UpdaterError("更新请求格式无效") from exc
    if not isinstance(request, dict):
        raise UpdaterError("更新请求格式无效")
    expected = {
        "schemaVersion", "applicationRoot", "dataRoot", "mainExecutable", "targetVersion", "parentPid",
        "stagingRoot", "healthPath", "resultPath", "files", "deletePaths",
    }
    if set(request) != expected or request["schemaVersion"] != REQUEST_SCHEMA_VERSION:
        raise UpdaterError("更新请求字段无效")
    return request


def _path_value(request: dict[str, Any], key: str) -> Path:
    value = request.get(key)
    if not isinstance(value, str) or not value:
        raise UpdaterError("更新请求路径无效")
    return Path(value).resolve()


def _validate_request(request: dict[str, Any]) -> tuple[Path, Path, Path, Path, Path, list[dict[str, Any]], list[str]]:
    application_root = _path_value(request, "applicationRoot")
    data_root = _path_value(request, "dataRoot")
    staging_root = _path_value(request, "stagingRoot")
    health_path = _path_value(request, "healthPath")
    result_path = _path_value(request, "resultPath")
    if not application_root.is_dir() or not staging_root.is_dir() or not data_root.is_dir():
        raise UpdaterError("更新目录不可用")
    try:
        data_root.relative_to(application_root)
    except ValueError as exc:
        raise UpdaterError("用户数据目录不在应用目录内") from exc
    main_executable = request.get("mainExecutable")
    if main_executable != "KAITools.exe":
        raise UpdaterError("主程序名称无效")
    target_version = request.get("targetVersion")
    if not isinstance(target_version, str) or len(target_version) > 40:
        raise UpdaterError("目标版本无效")
    if not isinstance(request.get("parentPid"), int) or request["parentPid"] < 1:
        raise UpdaterError("父进程标识无效")
    raw_files = request.get("files")
    if not isinstance(raw_files, list) or not raw_files:
        raise UpdaterError("更新文件不能为空")
    files: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw_files:
        if not isinstance(item, dict) or set(item) != {"path", "sha256", "size"}:
            raise UpdaterError("更新文件条目无效")
        path = normalize_relative_path(item["path"], allow_manifest=True)
        if path in seen:
            raise UpdaterError("更新文件路径重复")
        seen.add(path)
        require_sha256(item["sha256"])
        if not isinstance(item["size"], int) or isinstance(item["size"], bool) or item["size"] <= 0:
            raise UpdaterError("更新文件大小无效")
        source = safe_target(staging_root, path)
        if not source.is_file() or source.stat().st_size != item["size"] or sha256_file(source) != item["sha256"]:
            raise UpdaterError("暂存更新文件校验失败")
        files.append({"path": path, "sha256": item["sha256"], "size": item["size"]})
    raw_deletes = request.get("deletePaths")
    if not isinstance(raw_deletes, list):
        raise UpdaterError("删除文件列表无效")
    delete_paths: list[str] = []
    for value in raw_deletes:
        path = normalize_relative_path(value)
        if path in seen or path in delete_paths:
            raise UpdaterError("删除文件路径无效")
        delete_paths.append(path)
    return application_root, data_root, staging_root, health_path, result_path, files, delete_paths


def _wait_for_parent(pid: int, timeout: int = WAIT_PARENT_SECONDS) -> None:
    deadline = time.monotonic() + timeout
    if os.name == "nt":
        import ctypes

        synchronize = 0x00100000
        handle = ctypes.windll.kernel32.OpenProcess(synchronize, False, pid)
        if not handle:
            return
        try:
            remaining = max(0, int((deadline - time.monotonic()) * 1000))
            if ctypes.windll.kernel32.WaitForSingleObject(handle, remaining) == 0x102:
                raise UpdaterError("等待当前应用退出超时")
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)
        return
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)
    raise UpdaterError("等待当前应用退出超时")


def _move_to_backup(source: Path, backup_root: Path, application_root: Path) -> None:
    if not source.exists():
        return
    relative = source.relative_to(application_root).as_posix()
    backup = safe_target(backup_root, relative)
    backup.parent.mkdir(parents=True, exist_ok=True)
    os.replace(source, backup)


def _copy_replacement(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".update")
    try:
        shutil.copyfile(source, temporary)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def _restore_backup(application_root: Path, backup_root: Path, touched_paths: list[str]) -> None:
    for relative in reversed(touched_paths):
        target = safe_target(application_root, relative)
        target.unlink(missing_ok=True)
        backup = safe_target(backup_root, relative)
        if backup.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(backup, target)


def _write_result(path: Path, ok: bool, message: str, version: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    try:
        temporary.write_text(json.dumps({"ok": ok, "message": message, "version": version}, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _wait_for_health(path: Path, version: str, timeout: int = HEALTH_TIMEOUT_SECONDS) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(value, dict) and value.get("ok") is True and value.get("version") == version:
                return True
        except (OSError, json.JSONDecodeError):
            pass
        time.sleep(0.25)
    return False


def apply_update(request_path: Path, expected_sha256: str) -> int:
    request: dict[str, Any] | None = None
    result_path: Path | None = None
    application_root: Path | None = None
    backup_root: Path | None = None
    touched_paths: list[str] = []
    try:
        request = _read_request(request_path, expected_sha256)
        application_root, _data_root, staging_root, health_path, result_path, files, delete_paths = _validate_request(request)
        _wait_for_parent(request["parentPid"])
        health_path.unlink(missing_ok=True)
        backup_root = request_path.parent / "backup"
        backup_root.mkdir(parents=True, exist_ok=False)
        for relative in [*(item["path"] for item in files), *delete_paths]:
            target = safe_target(application_root, relative)
            _move_to_backup(target, backup_root, application_root)
            touched_paths.append(relative)
        for item in files:
            source = safe_target(staging_root, item["path"])
            target = safe_target(application_root, item["path"])
            _copy_replacement(source, target)
        executable = application_root / "KAITools.exe"
        process = subprocess.Popen(
            [str(executable), "--update-health-check", str(health_path)],
            cwd=str(application_root),
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if not _wait_for_health(health_path, request["targetVersion"]):
            process.terminate()
            process.wait(timeout=5)
            raise UpdaterError("新版本启动校验失败，已恢复旧版本")
        try:
            shutil.rmtree(backup_root)
        except OSError:
            # A healthy new application takes precedence over best-effort backup cleanup.
            pass
        _write_result(result_path, True, "更新完成", request["targetVersion"])
        return 0
    except Exception as exc:
        if application_root is not None and backup_root is not None and backup_root.exists():
            try:
                _restore_backup(application_root, backup_root, touched_paths)
                executable = application_root / "KAITools.exe"
                if executable.is_file():
                    subprocess.Popen([str(executable)], cwd=str(application_root), creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            except Exception:
                pass
        if result_path is not None and request is not None:
            _write_result(result_path, False, str(exc), str(request.get("targetVersion", "")))
        return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--request-sha256", required=True)
    args = parser.parse_args()
    try:
        require_sha256(args.request_sha256, "更新请求 SHA-256")
        return apply_update(Path(args.request), args.request_sha256)
    except (OSError, UpdateSecurityError, UpdaterError) as exc:
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
