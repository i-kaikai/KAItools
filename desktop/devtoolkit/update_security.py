from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path, PurePosixPath
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

PRODUCT_NAME = "KAITools"
SHA256_LENGTH = 64


class UpdateSecurityError(ValueError):
    """Raised when an update artifact does not satisfy the fixed trust contract."""


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def require_sha256(value: Any, label: str = "SHA-256") -> str:
    if not isinstance(value, str) or len(value) != SHA256_LENGTH or any(char not in "0123456789abcdef" for char in value):
        raise UpdateSecurityError(f"{label} 格式无效")
    return value


def normalize_relative_path(value: Any, *, allow_manifest: bool = False) -> str:
    if not isinstance(value, str) or not value or "\\" in value or len(value) > 320:
        raise UpdateSecurityError("更新文件路径无效")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise UpdateSecurityError("更新文件路径无效")
    if path.parts[0].lower() == "data":
        raise UpdateSecurityError("更新不能修改 data 目录")
    normalized = path.as_posix()
    if normalized == "app-manifest.json" and not allow_manifest:
        raise UpdateSecurityError("程序清单不能作为普通更新对象")
    return normalized


def safe_target(root: Path, relative_path: str) -> Path:
    relative = normalize_relative_path(relative_path, allow_manifest=True)
    root = root.resolve()
    target = root.joinpath(*PurePosixPath(relative).parts)
    current = root
    for part in PurePosixPath(relative).parts:
        current = current / part
        if current.exists() and current.is_symlink():
            raise UpdateSecurityError("更新路径不能包含符号链接")
    try:
        target.resolve(strict=False).relative_to(root)
    except ValueError as exc:
        raise UpdateSecurityError("更新文件路径超出应用目录") from exc
    return target


def load_public_key(path: Path) -> Ed25519PublicKey:
    try:
        loaded = serialization.load_pem_public_key(path.read_bytes())
    except (OSError, ValueError) as exc:
        raise UpdateSecurityError("更新公钥不可用") from exc
    if not isinstance(loaded, Ed25519PublicKey):
        raise UpdateSecurityError("更新公钥类型无效")
    return loaded


def load_private_key(path: Path) -> Ed25519PrivateKey:
    try:
        loaded = serialization.load_pem_private_key(path.read_bytes(), password=None)
    except (OSError, ValueError) as exc:
        raise UpdateSecurityError("更新私钥不可用") from exc
    if not isinstance(loaded, Ed25519PrivateKey):
        raise UpdateSecurityError("更新私钥类型无效")
    return loaded


def sign_json(value: Any, private_key: Ed25519PrivateKey) -> str:
    return base64.b64encode(private_key.sign(canonical_json(value))).decode("ascii")


def verify_json(value: Any, signature: bytes, public_key: Ed25519PublicKey) -> None:
    try:
        public_key.verify(signature, canonical_json(value))
    except InvalidSignature as exc:
        raise UpdateSecurityError("更新清单签名无效") from exc


def decode_signature(value: bytes) -> bytes:
    try:
        decoded = base64.b64decode(value.strip(), validate=True)
    except ValueError as exc:
        raise UpdateSecurityError("更新签名格式无效") from exc
    if len(decoded) != 64:
        raise UpdateSecurityError("更新签名长度无效")
    return decoded
