from __future__ import annotations

import base64
import io
import json
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from devtoolkit.paths import AppPaths
from devtoolkit.update_manager import UpdateError, UpdateManager
from devtoolkit.update_security import canonical_json, sha256_bytes, sign_json


class Response(io.BytesIO):
    def __enter__(self) -> "Response":
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()


def fixture_paths(tmp_path: Path) -> AppPaths:
    application = tmp_path / "KAITools"
    application.mkdir()
    (application / "data").mkdir()
    resources = tmp_path / "resources"
    update = resources / "update"
    update.mkdir(parents=True)
    (update / "update-policy.json").write_text(
        json.dumps({
            "schemaVersion": 1,
            "product": "KAITools",
            "channel": "stable",
            "mode": "file-sync",
            "latestUrl": "https://updates.example.test/kaitools/latest.json",
        }),
        encoding="utf-8",
    )
    return AppPaths(application, resources, application / "data")


def signed_feed(paths: AppPaths, files: list[tuple[str, bytes]], *, signature_valid: bool = True) -> dict[str, bytes]:
    private = Ed25519PrivateKey.generate()
    paths.update_public_key_file.write_bytes(
        private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    )
    manifest_files = [
        {"path": path, "sha256": sha256_bytes(content), "size": len(content), "object": f"objects/{sha256_bytes(content)}"}
        for path, content in files
    ]
    manifest = {"schemaVersion": 1, "product": "KAITools", "version": "9.9.9", "files": manifest_files}
    latest = {
        "schemaVersion": 1,
        "product": "KAITools",
        "channel": "stable",
        "version": "9.9.9",
        "manifest": "manifests/KAITools-v9.9.9.json",
        "manifestSha256": sha256_bytes(canonical_json(manifest)),
        "publishedAt": "2026-09-21",
        "releaseNotes": ["测试更新"],
        "mandatory": False,
    }
    base = "https://updates.example.test/kaitools/"
    entries = {
        base + "latest.json": canonical_json(latest),
        base + "latest.json.sig": (sign_json(latest, private) + "\n").encode("ascii"),
        base + "manifests/KAITools-v9.9.9.json": canonical_json(manifest),
        base + "manifests/KAITools-v9.9.9.json.sig": (sign_json(manifest, private) + "\n").encode("ascii"),
    }
    for path, content in files:
        entries[base + f"objects/{sha256_bytes(content)}"] = content
    if not signature_valid:
        entries[base + "latest.json.sig"] = base64.b64encode(b"x" * 64)
    return entries


def fake_urlopen(entries: dict[str, bytes]):
    def open_request(request: object, **_kwargs: object) -> Response:
        url = getattr(request, "full_url", request)
        if url not in entries:
            raise OSError(f"not found: {url}")
        return Response(entries[url])

    return open_request


def test_check_syncs_only_changed_latest_files_and_excludes_data(tmp_path: Path) -> None:
    paths = fixture_paths(tmp_path)
    (paths.application_root / "KAITools.exe").write_bytes(b"old")
    (paths.application_root / "data" / "notes.json").write_bytes(b"private user content")
    entries = signed_feed(paths, [("KAITools.exe", b"new"), ("_internal/runtime.bin", b"same")])

    result = UpdateManager(paths, urlopen=fake_urlopen(entries)).check()

    assert result["status"] == "update-available"
    assert result["filesToDownload"] == 2
    assert result["bytesToDownload"] == len(b"new") + len(b"same")
    assert (paths.application_root / "data" / "notes.json").read_bytes() == b"private user content"


def test_check_reports_repair_when_latest_version_files_are_damaged(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    paths = fixture_paths(tmp_path)
    monkeypatch.setattr("devtoolkit.update_manager.APP_VERSION", "9.9.9")
    (paths.application_root / "KAITools.exe").write_bytes(b"damaged")
    entries = signed_feed(paths, [("KAITools.exe", b"healthy")])

    result = UpdateManager(paths, urlopen=fake_urlopen(entries)).check()

    assert result["status"] == "repair-available"
    assert result["filesToDownload"] == 1


def test_check_repairs_a_missing_local_application_manifest(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    paths = fixture_paths(tmp_path)
    monkeypatch.setattr("devtoolkit.update_manager.APP_VERSION", "9.9.9")
    (paths.application_root / "KAITools.exe").write_bytes(b"healthy")
    entries = signed_feed(paths, [("KAITools.exe", b"healthy")])

    result = UpdateManager(paths, urlopen=fake_urlopen(entries)).check()

    assert result["status"] == "repair-available"
    assert result["filesToDownload"] == 0


def test_check_rejects_invalid_latest_signature_before_comparing_files(tmp_path: Path) -> None:
    paths = fixture_paths(tmp_path)
    entries = signed_feed(paths, [("KAITools.exe", b"new")], signature_valid=False)

    with pytest.raises(UpdateError, match="签名") as error:
        UpdateManager(paths, urlopen=fake_urlopen(entries)).check()

    assert error.value.code == "UPDATE_METADATA_INVALID"


def test_check_explains_when_server_returns_spa_html_for_latest_manifest(tmp_path: Path) -> None:
    paths = fixture_paths(tmp_path)
    entries = {"https://updates.example.test/kaitools/latest.json": b"<!doctype html><html><body>KAITools</body></html>"}

    with pytest.raises(UpdateError, match="回退到了 index.html") as error:
        UpdateManager(paths, urlopen=fake_urlopen(entries)).check()

    assert error.value.code == "UPDATE_METADATA_INVALID"


def test_check_rejects_a_signed_manifest_that_targets_user_data(tmp_path: Path) -> None:
    paths = fixture_paths(tmp_path)
    entries = signed_feed(paths, [("data/settings.json", b"malicious")])

    with pytest.raises(UpdateError, match="data") as error:
        UpdateManager(paths, urlopen=fake_urlopen(entries)).check()

    assert error.value.code == "UPDATE_METADATA_INVALID"


def test_start_install_stages_only_changed_files_and_never_stages_data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    paths = fixture_paths(tmp_path)
    (paths.application_root / "KAITools.exe").write_bytes(b"old")
    (paths.application_root / "KAIToolsUpdater.exe").write_bytes(b"updater")
    (paths.application_root / "data" / "settings.json").write_bytes(b"keep")
    entries = signed_feed(paths, [("KAITools.exe", b"new")])
    launched: list[list[str]] = []

    def launch(command: list[str], **_kwargs: object) -> None:
        launched.append(command)

    result = UpdateManager(paths, urlopen=fake_urlopen(entries), process_launcher=launch).start_install()

    assert result["restarting"] is True
    assert len(launched) == 1
    staged = list((paths.pending_dir / "updates").glob("*/staging/KAITools.exe"))
    assert len(staged) == 1 and staged[0].read_bytes() == b"new"
    assert not list((paths.pending_dir / "updates").glob("*/staging/data/**"))
    assert (paths.application_root / "data" / "settings.json").read_bytes() == b"keep"
