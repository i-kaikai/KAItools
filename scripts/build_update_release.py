from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "desktop"))

from devtoolkit.update_security import (
    PRODUCT_NAME,
    canonical_json,
    load_private_key,
    load_public_key,
    normalize_relative_path,
    sha256_bytes,
    sha256_file,
    sign_json,
)

SCHEMA_VERSION = 1
EXCLUDED_ROOTS = {"data", "app-manifest.json"}


def read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"{label} is invalid: {exc}") from exc
    if not isinstance(value, dict):
        raise SystemExit(f"{label} must be a JSON object")
    return value


def release_notes(version: str) -> list[str]:
    source = (ROOT / "RELEASE_NOTES.md").read_text(encoding="utf-8")
    match = re.search(rf"(?ms)^## v{re.escape(version)}\s*$\n(?P<body>.*?)(?=^## v|\Z)", source)
    if match is None:
        raise SystemExit(f"Missing release note entry for v{version}")
    changes = re.search(r"(?ms)^### 更新内容\s*$\n(?P<body>.*?)(?=^### |\Z)", match.group("body"))
    if changes is None:
        raise SystemExit(f"Missing change list for v{version}")
    items = [item.strip() for item in re.findall(r"(?m)^\s*-\s+(.+?)\s*$", changes.group("body"))]
    if not items or any(item == "TBD" for item in items):
        raise SystemExit(f"Release notes for v{version} must contain completed change items")
    return items


def release_date(version: str) -> str:
    source = (ROOT / "RELEASE_NOTES.md").read_text(encoding="utf-8")
    match = re.search(rf"(?ms)^## v{re.escape(version)}\s*$\n\s*发布日期：(?P<date>\d{{4}}-\d{{2}}-\d{{2}})", source)
    if match is None:
        raise SystemExit(f"Missing release date for v{version}")
    return match.group("date")


def managed_files(portable_root: Path, object_base: str) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    for path in sorted(portable_root.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(portable_root).as_posix()
        if relative.split("/", 1)[0] in EXCLUDED_ROOTS:
            continue
        normalized = normalize_relative_path(relative)
        digest = sha256_file(path)
        files.append({
            "path": normalized,
            "sha256": digest,
            "size": path.stat().st_size,
            "object": f"{object_base}/{digest}",
        })
    if not files:
        raise SystemExit("No managed program files found in the portable directory")
    return files


def write_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate signed latest-only KAITools file-sync update artifacts.")
    parser.add_argument("--portable-root", required=True, type=Path)
    parser.add_argument("--release-root", required=True, type=Path)
    parser.add_argument("--private-key", required=True, type=Path)
    args = parser.parse_args()
    portable_root = args.portable_root.resolve()
    release_root = args.release_root.resolve() / "updates"
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    policy = read_json(ROOT / "packaging" / "update-policy.json", "update policy")
    expected_policy = {"schemaVersion", "product", "channel", "mode", "latestUrl"}
    if set(policy) != expected_policy or policy.get("schemaVersion") != SCHEMA_VERSION or policy.get("product") != PRODUCT_NAME or policy.get("mode") != "file-sync":
        raise SystemExit("Update policy is invalid")
    latest_url = policy["latestUrl"]
    if not isinstance(latest_url, str) or not latest_url.endswith("/latest.json"):
        raise SystemExit("latestUrl must end with /latest.json")
    parsed = urlsplit(latest_url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.query or parsed.fragment:
        raise SystemExit("latestUrl must be an HTTPS URL")
    private_key = load_private_key(args.private_key.resolve())
    public_key = load_public_key(ROOT / "packaging" / "update-public-key.pem")
    if private_key.public_key().public_bytes_raw() != public_key.public_bytes_raw():
        raise SystemExit("Update private key does not match packaging/update-public-key.pem")
    object_base = "objects"
    files = managed_files(portable_root, object_base)
    manifest = {"schemaVersion": SCHEMA_VERSION, "product": PRODUCT_NAME, "version": version, "files": files}
    manifest_bytes = canonical_json(manifest)
    write_bytes(portable_root / "app-manifest.json", manifest_bytes)
    objects_root = release_root / "objects"
    for item in files:
        source = portable_root.joinpath(*item["path"].split("/"))
        destination = objects_root / item["sha256"]
        if not destination.exists():
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
    manifest_relative = f"manifests/KAITools-v{version}.json"
    manifest_path = release_root / manifest_relative
    write_bytes(manifest_path, manifest_bytes)
    write_bytes(manifest_path.with_suffix(manifest_path.suffix + ".sig"), (sign_json(manifest, private_key) + "\n").encode("ascii"))
    latest = {
        "schemaVersion": SCHEMA_VERSION,
        "product": PRODUCT_NAME,
        "channel": policy["channel"],
        "version": version,
        "manifest": manifest_relative,
        "manifestSha256": sha256_bytes(manifest_bytes),
        "publishedAt": release_date(version),
        "releaseNotes": release_notes(version),
        "mandatory": False,
    }
    latest_path = release_root / "latest.json"
    write_bytes(latest_path, canonical_json(latest))
    write_bytes(latest_path.with_suffix(".json.sig"), (sign_json(latest, private_key) + "\n").encode("ascii"))
    print(f"UPDATE_RELEASE_ROOT={release_root}")
    print(f"UPDATE_MANIFEST={manifest_path}")
    print(f"UPDATE_OBJECTS={len(files)}")
    print(f"UPDATE_LATEST_SHA256={sha256_file(latest_path)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
