from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "desktop"))

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def main() -> int:
    parser = argparse.ArgumentParser(description="Create the initial Ed25519 key pair for KAITools update manifests.")
    parser.add_argument("--private-key", required=True, type=Path, help="Ignored local or CI-secret private key path")
    parser.add_argument("--public-key", type=Path, default=ROOT / "packaging" / "update-public-key.pem")
    args = parser.parse_args()
    private_key = args.private_key.resolve()
    public_key = args.public_key.resolve()
    if private_key.exists() or public_key.exists():
        raise SystemExit("Refusing to overwrite an existing update signing key")
    private_key.parent.mkdir(parents=True, exist_ok=True)
    public_key.parent.mkdir(parents=True, exist_ok=True)
    key = Ed25519PrivateKey.generate()
    private_key.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    public_key.write_bytes(
        key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )
    print(f"UPDATE_PUBLIC_KEY={public_key}")
    print("Store the private key outside the repository and configure it only as a release secret.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
