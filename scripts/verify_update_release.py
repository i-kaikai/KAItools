from __future__ import annotations

import argparse
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any, TypeVar

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "desktop"))

from devtoolkit.update_security import (  # noqa: E402
    PRODUCT_NAME,
    UpdateSecurityError,
    decode_signature,
    load_public_key,
    normalize_relative_path,
    require_sha256,
    sha256_bytes,
    sha256_file,
    verify_json,
)


# A release can contain hundreds of objects. Keep the public verification
# deliberately conservative and recycle clients between batches so transient
# runner socket exhaustion does not abort a valid release.
REMOTE_VERIFY_WORKERS = 2
REMOTE_VERIFY_BATCH_SIZE = 16
REMOTE_VERIFY_TIMEOUT_SECONDS = 30.0
REMOTE_VERIFY_CHUNK_BYTES = 1024 * 1024
REMOTE_METADATA_MAX_BYTES = 4 * 1024 * 1024
REMOTE_VERIFY_RETRY_ATTEMPTS = 6
REMOTE_VERIFY_RETRY_DELAY_SECONDS = 1.0
RETRYABLE_HTTP_STATUS_CODES = {408, 429, 500, 502, 503, 504}

T = TypeVar("T")


def read_json(raw: bytes, label: str) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise UpdateSecurityError(f"{label} 不是有效 JSON") from exc
    if not isinstance(value, dict):
        raise UpdateSecurityError(f"{label} 格式无效")
    return value


def validate_latest(latest: dict[str, Any]) -> None:
    expected = {"schemaVersion", "product", "channel", "version", "manifest", "manifestSha256", "publishedAt", "releaseNotes", "mandatory"}
    if set(latest) != expected or latest.get("schemaVersion") != 1 or latest.get("product") != PRODUCT_NAME:
        raise UpdateSecurityError("最新版本清单字段无效")
    if not isinstance(latest.get("version"), str) or not isinstance(latest.get("manifest"), str):
        raise UpdateSecurityError("最新版本清单版本或路径无效")
    require_sha256(latest["manifestSha256"], "版本清单 SHA-256")


def validate_manifest(manifest: dict[str, Any], version: str) -> None:
    expected = {"schemaVersion", "product", "version", "files"}
    if set(manifest) != expected or manifest.get("schemaVersion") != 1 or manifest.get("product") != PRODUCT_NAME or manifest.get("version") != version:
        raise UpdateSecurityError("版本文件清单字段无效")
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise UpdateSecurityError("版本文件清单不能为空")
    seen: set[str] = set()
    for item in files:
        if not isinstance(item, dict) or set(item) != {"path", "sha256", "size", "object"}:
            raise UpdateSecurityError("更新文件条目无效")
        path = normalize_relative_path(item["path"])
        if path in seen:
            raise UpdateSecurityError("更新文件路径重复")
        seen.add(path)
        require_sha256(item["sha256"])
        if not isinstance(item["size"], int) or item["size"] <= 0 or not isinstance(item["object"], str):
            raise UpdateSecurityError("更新文件条目格式无效")


def verify_document(document: dict[str, Any], signature: bytes, public_key: Any) -> None:
    verify_json(document, decode_signature(signature), public_key)


def verify_local(root: Path, public_key_path: Path) -> None:
    public_key = load_public_key(public_key_path)
    latest_path = root / "latest.json"
    latest_raw = latest_path.read_bytes()
    latest = read_json(latest_raw, "最新版本清单")
    verify_document(latest, (root / "latest.json.sig").read_bytes(), public_key)
    validate_latest(latest)
    manifest_path = root / latest["manifest"]
    manifest_raw = manifest_path.read_bytes()
    if sha256_bytes(manifest_raw) != latest["manifestSha256"]:
        raise UpdateSecurityError("版本清单摘要不匹配")
    manifest = read_json(manifest_raw, "版本文件清单")
    verify_document(manifest, (manifest_path.with_suffix(manifest_path.suffix + ".sig")).read_bytes(), public_key)
    validate_manifest(manifest, latest["version"])
    for item in manifest["files"]:
        object_path = root / item["object"]
        if not object_path.is_file() or object_path.stat().st_size != item["size"] or sha256_file(object_path) != item["sha256"]:
            raise UpdateSecurityError(f"更新对象校验失败: {item['path']}")


def require_httpx() -> Any:
    try:
        import httpx
    except ImportError as exc:
        raise UpdateSecurityError("公网更新验签缺少 httpx[http2] 依赖") from exc
    return httpx


def create_remote_client(httpx: Any) -> Any:
    return httpx.Client(
        http2=True,
        follow_redirects=True,
        headers={"User-Agent": "KAITools-Release-Verifier/1"},
        timeout=httpx.Timeout(REMOTE_VERIFY_TIMEOUT_SECONDS),
        limits=httpx.Limits(
            max_connections=REMOTE_VERIFY_WORKERS,
            max_keepalive_connections=REMOTE_VERIFY_WORKERS,
            keepalive_expiry=REMOTE_VERIFY_TIMEOUT_SECONDS,
        ),
    )


def retry_remote_request(operation: Callable[[], T], resource: str) -> T:
    httpx = require_httpx()
    for attempt in range(1, REMOTE_VERIFY_RETRY_ATTEMPTS + 1):
        try:
            return operation()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code not in RETRYABLE_HTTP_STATUS_CODES or attempt == REMOTE_VERIFY_RETRY_ATTEMPTS:
                raise
        except (OSError, httpx.TransportError):
            if attempt == REMOTE_VERIFY_RETRY_ATTEMPTS:
                raise
        delay = REMOTE_VERIFY_RETRY_DELAY_SECONDS * (2 ** (attempt - 1))
        print(
            f"UPDATE_VERIFY_RETRY attempt={attempt}/{REMOTE_VERIFY_RETRY_ATTEMPTS} resource={resource} delay={delay:.1f}s",
            file=sys.stderr,
        )
        time.sleep(delay)
    raise RuntimeError("unreachable")


def fetch(client: Any, url: str) -> bytes:
    def read() -> bytes:
        raw = bytearray()
        with client.stream("GET", url) as response:
            response.raise_for_status()
            for chunk in response.iter_bytes(REMOTE_VERIFY_CHUNK_BYTES):
                raw.extend(chunk)
                if len(raw) > REMOTE_METADATA_MAX_BYTES:
                    raise UpdateSecurityError("公网更新元数据超过大小限制")
        return bytes(raw)

    return retry_remote_request(read, url)


def manifest_url(latest_url: str, path: str) -> str:
    normalized = normalize_relative_path(path)
    if not normalized.startswith("manifests/") or not normalized.endswith(".json"):
        raise UpdateSecurityError("版本清单路径无效")
    return urllib.parse.urljoin(latest_url, normalized)


def verify_remote_object(client: Any, latest_url: str, item: dict[str, Any]) -> None:
    object_url = urllib.parse.urljoin(latest_url, item["object"])

    def verify() -> None:
        size = 0
        digest = hashlib.sha256()
        with client.stream("GET", object_url) as response:
            response.raise_for_status()
            for chunk in response.iter_bytes(REMOTE_VERIFY_CHUNK_BYTES):
                size += len(chunk)
                digest.update(chunk)
        if size != item["size"] or digest.hexdigest() != item["sha256"]:
            raise UpdateSecurityError(f"公网更新对象校验失败: {item['path']}")

    retry_remote_request(verify, object_url)


def changed_files(files: list[dict[str, Any]], previous: dict[str, Any] | None) -> list[dict[str, Any]]:
    if previous is None:
        return files
    previous_by_path = {item["path"]: item for item in previous["files"]}
    return [item for item in files if previous_by_path.get(item["path"]) != item]


def verify_remote_object_batch(client: Any, latest_url: str, files: list[dict[str, Any]]) -> None:
    with ThreadPoolExecutor(max_workers=REMOTE_VERIFY_WORKERS) as executor:
        futures = [executor.submit(verify_remote_object, client, latest_url, item) for item in files]
        for future in as_completed(futures):
            future.result()


def verify_remote_objects(client_factory: Callable[[], Any], latest_url: str, files: list[dict[str, Any]]) -> None:
    for offset in range(0, len(files), REMOTE_VERIFY_BATCH_SIZE):
        batch = files[offset : offset + REMOTE_VERIFY_BATCH_SIZE]
        with client_factory() as client:
            verify_remote_object_batch(client, latest_url, batch)


def verify_previous_release(
    client: Any,
    latest_url: str,
    latest_path: Path,
    signature_path: Path,
    public_key: Any,
    current_version: str,
) -> dict[str, Any]:
    previous_latest = read_json(latest_path.read_bytes(), "上一版公网最新版本清单")
    verify_document(previous_latest, signature_path.read_bytes(), public_key)
    validate_latest(previous_latest)
    previous_url = manifest_url(latest_url, previous_latest["manifest"])
    previous_raw = fetch(client, previous_url)
    if sha256_bytes(previous_raw) != previous_latest["manifestSha256"]:
        raise UpdateSecurityError("上一版公网版本清单摘要不匹配")
    previous = read_json(previous_raw, "上一版公网版本文件清单")
    verify_document(previous, fetch(client, previous_url + ".sig"), public_key)
    previous_version = previous.get("version")
    if not isinstance(previous_version, str) or previous_version == current_version:
        raise UpdateSecurityError("上一版公网版本文件清单版本无效")
    validate_manifest(previous, previous_version)
    return previous


def verify_remote(
    latest_url: str,
    public_key_path: Path,
    previous_latest: Path | None = None,
    previous_latest_signature: Path | None = None,
) -> None:
    if (previous_latest is None) != (previous_latest_signature is None):
        raise UpdateSecurityError("上一版公网元数据和签名必须同时提供")
    public_key = load_public_key(public_key_path)
    httpx = require_httpx()
    try:
        with create_remote_client(httpx) as client:
            latest_raw = fetch(client, latest_url)
            latest = read_json(latest_raw, "公网最新版本清单")
            verify_document(latest, fetch(client, latest_url + ".sig"), public_key)
            validate_latest(latest)
            current_manifest_url = manifest_url(latest_url, latest["manifest"])
            manifest_raw = fetch(client, current_manifest_url)
            if sha256_bytes(manifest_raw) != latest["manifestSha256"]:
                raise UpdateSecurityError("公网版本清单摘要不匹配")
            manifest = read_json(manifest_raw, "公网版本文件清单")
            verify_document(manifest, fetch(client, current_manifest_url + ".sig"), public_key)
            validate_manifest(manifest, latest["version"])
            previous = None
            if previous_latest and previous_latest_signature:
                try:
                    previous = verify_previous_release(
                        client,
                        latest_url,
                        previous_latest,
                        previous_latest_signature,
                        public_key,
                        latest["version"],
                    )
                except (OSError, httpx.HTTPError, UpdateSecurityError) as exc:
                    print(f"UPDATE_VERIFY_PREVIOUS_UNAVAILABLE: {exc}; falling back to full verification", file=sys.stderr)
            files = changed_files(manifest["files"], previous)
        verify_remote_objects(lambda: create_remote_client(httpx), latest_url, files)
    except httpx.HTTPError as exc:
        raise UpdateSecurityError(f"公网更新请求失败: {exc}") from exc
    skipped = len(manifest["files"]) - len(files)
    print(f"UPDATE_VERIFY_REMOTE_OK checked={len(files)} skipped_unchanged={skipped}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify signed KAITools update artifacts locally or from HTTPS.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--updates-root", type=Path)
    group.add_argument("--remote-latest-url")
    parser.add_argument("--public-key", type=Path, default=ROOT / "packaging" / "update-public-key.pem")
    parser.add_argument("--previous-latest", type=Path, help="发布前保存的上一版 latest.json")
    parser.add_argument("--previous-latest-signature", type=Path, help="发布前保存的上一版 latest.json.sig")
    args = parser.parse_args()
    try:
        if args.updates_root:
            verify_local(args.updates_root.resolve(), args.public_key.resolve())
        else:
            verify_remote(
                args.remote_latest_url,
                args.public_key.resolve(),
                args.previous_latest.resolve() if args.previous_latest else None,
                args.previous_latest_signature.resolve() if args.previous_latest_signature else None,
            )
    except (OSError, UpdateSecurityError) as exc:
        print(f"UPDATE_VERIFY_FAILED: {exc}", file=sys.stderr)
        return 1
    print("UPDATE_VERIFY_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
