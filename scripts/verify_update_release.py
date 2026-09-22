from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

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


REMOTE_VERIFY_WORKERS = 16


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


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "KAITools-Release-Verifier/1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read(2 * 1024 * 1024 * 1024)


def verify_remote_object(latest_url: str, item: dict[str, Any]) -> None:
    object_raw = fetch(urllib.parse.urljoin(latest_url, item["object"]))
    if len(object_raw) != item["size"] or sha256_bytes(object_raw) != item["sha256"]:
        raise UpdateSecurityError(f"公网更新对象校验失败: {item['path']}")


def verify_remote_objects(latest_url: str, files: list[dict[str, Any]]) -> None:
    with ThreadPoolExecutor(max_workers=REMOTE_VERIFY_WORKERS) as executor:
        futures = [executor.submit(verify_remote_object, latest_url, item) for item in files]
        for future in as_completed(futures):
            future.result()


def verify_remote(latest_url: str, public_key_path: Path) -> None:
    public_key = load_public_key(public_key_path)
    latest_raw = fetch(latest_url)
    latest = read_json(latest_raw, "公网最新版本清单")
    verify_document(latest, fetch(latest_url + ".sig"), public_key)
    validate_latest(latest)
    manifest_url = urllib.parse.urljoin(latest_url, latest["manifest"])
    manifest_raw = fetch(manifest_url)
    if sha256_bytes(manifest_raw) != latest["manifestSha256"]:
        raise UpdateSecurityError("公网版本清单摘要不匹配")
    manifest = read_json(manifest_raw, "公网版本文件清单")
    verify_document(manifest, fetch(manifest_url + ".sig"), public_key)
    validate_manifest(manifest, latest["version"])
    verify_remote_objects(latest_url, manifest["files"])


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify signed KAITools update artifacts locally or from HTTPS.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--updates-root", type=Path)
    group.add_argument("--remote-latest-url")
    parser.add_argument("--public-key", type=Path, default=ROOT / "packaging" / "update-public-key.pem")
    args = parser.parse_args()
    try:
        if args.updates_root:
            verify_local(args.updates_root.resolve(), args.public_key.resolve())
        else:
            verify_remote(args.remote_latest_url, args.public_key.resolve())
    except (OSError, urllib.error.URLError, UpdateSecurityError) as exc:
        print(f"UPDATE_VERIFY_FAILED: {exc}", file=sys.stderr)
        return 1
    print("UPDATE_VERIFY_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
