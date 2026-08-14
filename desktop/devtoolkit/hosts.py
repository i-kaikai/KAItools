from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import os
import re
import tempfile
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from .paths import AppPaths

SYSTEM_HOSTS_PATH = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "drivers" / "etc" / "hosts"
REQUEST_TTL_SECONDS = 120
MAX_BACKUPS = 20
MAX_HOSTS_BYTES = 2 * 1024 * 1024
HOSTNAME_PATTERN = re.compile(r"^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?(?:\.[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?)*$")


class HostsError(RuntimeError):
    pass


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def detect_encoding(raw: bytes) -> str:
    if raw.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    try:
        raw.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        return "mbcs"


def detect_newline(raw: bytes) -> str:
    return "\r\n" if b"\r\n" in raw else "\n"


def decode_hosts_bytes(raw: bytes) -> tuple[str, str, str]:
    if len(raw) > MAX_HOSTS_BYTES:
        raise HostsError("Hosts 文件超过 2 MB 限制")
    encoding = detect_encoding(raw)
    try:
        text = raw.decode(encoding)
    except UnicodeDecodeError as exc:
        raise HostsError(f"无法使用 {encoding} 读取 Hosts 文件") from exc
    if "\x00" in text:
        raise HostsError("Hosts 文件包含无效的空字符")
    return text, encoding, detect_newline(raw)


def validate_hosts_text(text: str) -> None:
    if not isinstance(text, str):
        raise HostsError("Hosts 内容必须是文本")
    if "\x00" in text:
        raise HostsError("Hosts 内容包含无效的空字符")
    for line_number, original_line in enumerate(
        text.replace("\r\n", "\n").replace("\r", "\n").split("\n"),
        start=1,
    ):
        line = original_line.split("#", 1)[0].strip()
        if not line:
            continue
        fields = line.split()
        if len(fields) < 2:
            raise HostsError(f"Hosts 第 {line_number} 行缺少 hostname")
        try:
            ipaddress.ip_address(fields[0])
        except ValueError as exc:
            raise HostsError(f"Hosts 第 {line_number} 行 IP 地址无效：{fields[0]}") from exc
        for hostname in fields[1:]:
            try:
                _normalize_hostname(hostname)
            except HostsError as exc:
                raise HostsError(f"Hosts 第 {line_number} 行 {exc}") from exc


def encode_hosts_text(text: str, current_raw: bytes) -> bytes:
    if not isinstance(text, str):
        raise HostsError("Hosts 内容必须是文本")
    if len(text.encode("utf-8")) > MAX_HOSTS_BYTES:
        raise HostsError("Hosts 内容超过 2 MB 限制")
    validate_hosts_text(text)
    current_text, encoding, newline = decode_hosts_bytes(current_raw)
    if text == current_text:
        return current_raw
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    normalized = newline.join(normalized.split("\n"))
    try:
        desired = normalized.encode(encoding)
    except UnicodeEncodeError as exc:
        raise HostsError(f"Hosts 当前编码 {encoding} 无法保存输入字符") from exc
    if len(desired) > MAX_HOSTS_BYTES:
        raise HostsError("Hosts 内容超过 2 MB 限制")
    return desired


def validate_hosts_bytes(raw: bytes) -> None:
    text, _, _ = decode_hosts_bytes(raw)
    validate_hosts_text(text)


def _normalize_hostname(value: Any) -> str:
    if not isinstance(value, str):
        raise HostsError("hostname 必须是文本")
    value = value.strip().rstrip(".")
    if not value or len(value) > 253 or any(character.isspace() for character in value):
        raise HostsError(f"hostname 无效：{value or '(空)'}")
    try:
        ascii_value = value.encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise HostsError(f"hostname 无效：{value}") from exc
    if not HOSTNAME_PATTERN.fullmatch(ascii_value):
        raise HostsError(f"hostname 无效：{value}")
    return ascii_value


def create_backup(paths: AppPaths, raw: bytes) -> Path:
    paths.backups_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    path = paths.backups_dir / f"{stamp}_{sha256_bytes(raw)[:8]}.hosts"
    _atomic_write_bytes(path, raw)
    backups = sorted(paths.backups_dir.glob("*.hosts"), key=lambda item: item.stat().st_mtime, reverse=True)
    for stale in backups[MAX_BACKUPS:]:
        stale.unlink(missing_ok=True)
    return path


def list_backups(paths: AppPaths) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for path in sorted(paths.backups_dir.glob("*.hosts"), key=lambda item: item.stat().st_mtime, reverse=True):
        stat = path.stat()
        result.append(
            {
                "id": path.name,
                "createdAt": datetime.fromtimestamp(stat.st_mtime).astimezone().isoformat(),
                "size": stat.st_size,
                "sha256": sha256_bytes(path.read_bytes()),
            }
        )
    return result


def backup_path(paths: AppPaths, backup_id: str) -> Path:
    if not re.fullmatch(r"[0-9]{8}-[0-9]{6}-[0-9]{6}_[0-9a-f]{8}\.hosts", backup_id):
        raise HostsError("备份标识无效")
    path = (paths.backups_dir / backup_id).resolve()
    if path.parent != paths.backups_dir.resolve() or not path.is_file():
        raise HostsError("Hosts 备份不存在")
    return path


def _atomic_write_bytes(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def prepare_request(paths: AppPaths, current_raw: bytes, desired_raw: bytes, action: str, target: Path = SYSTEM_HOSTS_PATH) -> tuple[Path, str]:
    request_id = uuid.uuid4().hex
    request = {
        "version": 1,
        "id": request_id,
        "action": action,
        "createdAt": time.time(),
        "target": str(target.resolve()),
        "sourceSha256": sha256_bytes(current_raw),
        "desiredSha256": sha256_bytes(desired_raw),
        "desiredBase64": base64.b64encode(desired_raw).decode("ascii"),
    }
    raw = json.dumps(request, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    path = paths.pending_dir / f"{request_id}.json"
    _atomic_write_bytes(path, raw)
    return path, sha256_bytes(raw)


def request_status_path(request_path: Path) -> Path:
    return request_path.with_suffix(".status.json")


def _write_status(path: Path, ok: bool, code: str, message: str) -> None:
    raw = json.dumps(
        {"ok": ok, "code": code, "message": message},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    _atomic_write_bytes(path, raw)


def execute_request(request_path: Path, expected_sha256: str, paths: AppPaths, allowed_target: Path = SYSTEM_HOSTS_PATH) -> int:
    status_path: Path | None = None
    try:
        resolved = request_path.resolve()
        if (
            resolved.parent != paths.pending_dir.resolve()
            or not re.fullmatch(r"[0-9a-f]{32}\.json", resolved.name)
            or not resolved.is_file()
        ):
            raise HostsError("写入请求路径无效")
        status_path = request_status_path(resolved)
        raw = resolved.read_bytes()
        if sha256_bytes(raw) != expected_sha256:
            raise HostsError("写入请求摘要不匹配")
        request = json.loads(raw.decode("utf-8"))
        if request.get("version") != 1 or request.get("action") not in {"apply", "restore"}:
            raise HostsError("写入请求格式无效")
        if abs(time.time() - float(request.get("createdAt", 0))) > REQUEST_TTL_SECONDS:
            raise HostsError("写入请求已过期")
        target = Path(str(request.get("target", ""))).resolve()
        if os.path.normcase(target) != os.path.normcase(allowed_target.resolve()):
            raise HostsError("拒绝写入非系统 Hosts 路径")
        desired = base64.b64decode(request.get("desiredBase64", ""), validate=True)
        if sha256_bytes(desired) != request.get("desiredSha256"):
            raise HostsError("待写入内容摘要不匹配")
        current = target.read_bytes()
        if sha256_bytes(current) != request.get("sourceSha256"):
            raise HostsError("系统 Hosts 已被其他程序修改，请重新预览后应用")
        validate_hosts_bytes(desired)
        create_backup(paths, current)
        _atomic_write_bytes(target, desired)
        if sha256_bytes(target.read_bytes()) != request.get("desiredSha256"):
            raise HostsError("写入后的 Hosts 校验失败")
        _write_status(status_path, True, "OK", "Hosts 已更新")
        return 0
    except Exception as exc:
        if status_path is not None:
            _write_status(status_path, False, "HOSTS_WRITE_FAILED", str(exc))
        return 1


def read_status(request_path: Path) -> dict[str, Any]:
    status_path = request_status_path(request_path)
    try:
        return json.loads(status_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HostsError("未收到管理员写入结果") from exc
    finally:
        request_path.unlink(missing_ok=True)
        status_path.unlink(missing_ok=True)
