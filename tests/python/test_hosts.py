from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

from devtoolkit.hosts import (
    create_backup,
    decode_hosts_bytes,
    encode_hosts_text,
    execute_request,
    prepare_request,
    read_status,
)
from devtoolkit.paths import AppPaths


def paths(tmp_path: Path) -> AppPaths:
    value = AppPaths(tmp_path, tmp_path / "resources", tmp_path / "data")
    value.pending_dir.mkdir(parents=True)
    value.backups_dir.mkdir(parents=True)
    return value


def test_elevated_request_validates_hash_and_writes_only_allowed_target(tmp_path: Path) -> None:
    app_paths = paths(tmp_path)
    target = tmp_path / "hosts"
    current = b"127.0.0.1 localhost\r\n"
    target.write_bytes(current)
    desired = current + b"127.0.0.1 api.local\r\n"
    request, digest = prepare_request(app_paths, current, desired, "apply", target)

    assert execute_request(request, digest, app_paths, target) == 0
    assert target.read_bytes() == desired
    assert len(list(app_paths.backups_dir.glob("*.hosts"))) == 1
    assert read_status(request)["ok"] is True


def test_elevated_request_rejects_modified_and_expired_requests(tmp_path: Path) -> None:
    app_paths = paths(tmp_path)
    target = tmp_path / "hosts"
    target.write_bytes(b"base\n")
    request, digest = prepare_request(app_paths, b"base\n", b"changed\n", "apply", target)
    request.write_bytes(request.read_bytes() + b" ")
    assert execute_request(request, digest, app_paths, target) == 1
    assert read_status(request)["ok"] is False

    request, _ = prepare_request(app_paths, b"base\n", b"changed\n", "apply", target)
    payload = json.loads(request.read_text("utf-8"))
    payload["createdAt"] = time.time() - 1000
    raw = json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode()
    request.write_bytes(raw)
    assert execute_request(request, hashlib.sha256(raw).hexdigest(), app_paths, target) == 1
    assert "过期" in read_status(request)["message"]


def test_elevated_request_accepts_complete_hosts_edit(tmp_path: Path) -> None:
    app_paths = paths(tmp_path)
    target = tmp_path / "hosts"
    current = b"127.0.0.1 localhost\r\n"
    target.write_bytes(current)
    desired = (
        b"# complete file edit\r\n"
        b"127.0.0.2 changed.local\r\n"
        b"127.0.0.1\tapi.local\r\n"
    )
    request, digest = prepare_request(app_paths, current, desired, "apply", target)

    assert execute_request(request, digest, app_paths, target) == 0
    assert target.read_bytes() == desired
    assert read_status(request)["ok"] is True


def test_elevated_request_rejects_invalid_hosts_syntax(tmp_path: Path) -> None:
    app_paths = paths(tmp_path)
    target = tmp_path / "hosts"
    current = b"127.0.0.1 localhost\n"
    target.write_bytes(current)
    desired = current + b"not-a-hosts-entry\n"
    request, digest = prepare_request(app_paths, current, desired, "apply", target)

    assert execute_request(request, digest, app_paths, target) == 1
    assert target.read_bytes() == current
    assert "缺少 hostname" in read_status(request)["message"]


def test_full_file_edit_preserves_bom_and_crlf() -> None:
    current = b"\xef\xbb\xbf127.0.0.1 localhost\r\n"
    desired = encode_hosts_text(
        "127.0.0.1 localhost\n::1 localhost ip6-localhost\n",
        current,
    )
    content, encoding, newline = decode_hosts_bytes(desired)

    assert desired.startswith(b"\xef\xbb\xbf")
    assert b"\r\n" in desired
    assert encoding == "utf-8-sig"
    assert newline == "\r\n"
    assert "ip6-localhost" in content


def test_backup_retention_keeps_latest_twenty(tmp_path: Path) -> None:
    app_paths = paths(tmp_path)
    for index in range(23):
        create_backup(app_paths, f"hosts-{index}".encode())

    backups = list(app_paths.backups_dir.glob("*.hosts"))
    assert len(backups) == 20
