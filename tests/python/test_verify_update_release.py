from __future__ import annotations

import json
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

import scripts.verify_update_release as verifier
from devtoolkit.update_security import sha256_bytes


def test_verify_remote_objects_checks_every_object_with_bounded_workers(monkeypatch) -> None:
    workers = 2
    files = [
        {"path": f"file-{index}", "object": f"objects/{index}", "size": 1, "sha256": sha256_bytes(bytes([index]))}
        for index in range(8)
    ]
    active = 0
    peak_active = 0
    verified: list[str] = []
    lock = threading.Lock()

    def fake_verify(_: Any, __: str, item: dict[str, Any]) -> None:
        nonlocal active, peak_active
        with lock:
            active += 1
            peak_active = max(peak_active, active)
            verified.append(item["path"])
        time.sleep(0.01)
        with lock:
            active -= 1

    monkeypatch.setattr(verifier, "REMOTE_VERIFY_WORKERS", workers)
    monkeypatch.setattr(verifier, "verify_remote_object", fake_verify)

    verifier.verify_remote_objects(object(), "https://updates.example/downloads/kaitools/latest.json", files)

    assert sorted(verified) == [f"file-{index}" for index in range(8)]
    assert peak_active == workers


def test_changed_files_only_returns_manifest_entries_that_differ() -> None:
    unchanged = {"path": "same", "object": "objects/same", "size": 1, "sha256": "a" * 64}
    previous = {"schemaVersion": 1, "product": "KAITools", "version": "1.4.14", "files": [unchanged]}
    changed = {"path": "updated", "object": "objects/new", "size": 2, "sha256": "b" * 64}
    added = {"path": "added", "object": "objects/added", "size": 3, "sha256": "c" * 64}

    assert verifier.changed_files([unchanged, changed, added], previous) == [changed, added]
    assert verifier.changed_files([unchanged, changed], None) == [unchanged, changed]


def test_verify_remote_rejects_only_one_previous_metadata_path(tmp_path: Path) -> None:
    with pytest.raises(verifier.UpdateSecurityError, match="必须同时提供"):
        verifier.verify_remote("https://updates.example/latest.json", tmp_path / "public.pem", tmp_path / "latest.json")


def test_verify_previous_release_authenticates_saved_latest_and_manifest(monkeypatch, tmp_path: Path) -> None:
    previous_manifest = {
        "schemaVersion": 1,
        "product": "KAITools",
        "version": "1.4.14",
        "files": [{"path": "same", "object": "objects/same", "size": 1, "sha256": "a" * 64}],
    }
    previous_raw = json.dumps(previous_manifest).encode()
    previous_latest = {
        "schemaVersion": 1,
        "product": "KAITools",
        "channel": "stable",
        "version": "1.4.14",
        "manifest": "manifests/KAITools-v1.4.14.json",
        "manifestSha256": sha256_bytes(previous_raw),
        "publishedAt": "2026-09-22",
        "releaseNotes": [],
        "mandatory": False,
    }
    latest_path = tmp_path / "latest.json"
    signature_path = tmp_path / "latest.json.sig"
    latest_path.write_text(json.dumps(previous_latest), encoding="utf-8")
    signature_path.write_bytes(b"latest-signature")
    verified: list[dict[str, Any]] = []

    def fake_fetch(_: Any, url: str) -> bytes:
        if url.endswith(".json.sig"):
            return b"manifest-signature"
        return previous_raw

    monkeypatch.setattr(verifier, "fetch", fake_fetch)
    monkeypatch.setattr(verifier, "verify_document", lambda document, _signature, _key: verified.append(document))

    actual = verifier.verify_previous_release(
        object(),
        "https://updates.example/downloads/kaitools/latest.json",
        latest_path,
        signature_path,
        object(),
        "1.4.15",
    )

    assert actual == previous_manifest
    assert verified == [previous_latest, previous_manifest]


class FakeResponse:
    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = chunks

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def raise_for_status(self) -> None:
        return None

    def iter_bytes(self, _: int) -> Iterator[bytes]:
        return iter(self.chunks)


class FakeClient:
    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = chunks
        self.urls: list[str] = []

    def stream(self, _: str, url: str) -> FakeResponse:
        self.urls.append(url)
        return FakeResponse(self.chunks)


def test_verify_remote_object_streams_sha256_without_buffering_the_object() -> None:
    chunks = [b"KAIT", b"ools"]
    raw = b"".join(chunks)
    client = FakeClient(chunks)
    item = {"path": "KAITools.exe", "object": "objects/example", "size": len(raw), "sha256": sha256_bytes(raw)}

    verifier.verify_remote_object(client, "https://updates.example/downloads/kaitools/latest.json", item)

    assert client.urls == ["https://updates.example/downloads/kaitools/objects/example"]
