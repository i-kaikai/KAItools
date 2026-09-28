from __future__ import annotations

import base64
import io
import json
import time
from datetime import datetime, timedelta, timezone
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


def signed_feed(
    paths: AppPaths,
    files: list[tuple[str, bytes]],
    *,
    signature_valid: bool = True,
    version: str = "9.9.9",
) -> dict[str, bytes]:
    private = Ed25519PrivateKey.generate()
    paths.update_public_key_file.write_bytes(
        private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    )
    manifest_files = [
        {"path": path, "sha256": sha256_bytes(content), "size": len(content), "object": f"objects/{sha256_bytes(content)}"}
        for path, content in files
    ]
    manifest = {"schemaVersion": 1, "product": "KAITools", "version": version, "files": manifest_files}
    latest = {
        "schemaVersion": 1,
        "product": "KAITools",
        "channel": "stable",
        "version": version,
        "manifest": f"manifests/KAITools-v{version}.json",
        "manifestSha256": sha256_bytes(canonical_json(manifest)),
        "publishedAt": "2026-09-21",
        "releaseNotes": ["测试更新"],
        "mandatory": False,
    }
    base = "https://updates.example.test/kaitools/"
    entries = {
        base + "latest.json": canonical_json(latest),
        base + "latest.json.sig": (sign_json(latest, private) + "\n").encode("ascii"),
        base + f"manifests/KAITools-v{version}.json": canonical_json(manifest),
        base + f"manifests/KAITools-v{version}.json.sig": (sign_json(manifest, private) + "\n").encode("ascii"),
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


def test_check_latest_reads_metadata_without_scanning_local_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    paths = fixture_paths(tmp_path)
    monkeypatch.setattr("devtoolkit.update_manager.APP_VERSION", "1.0.0")
    entries = signed_feed(paths, [("KAITools.exe", b"new")])

    result = UpdateManager(paths, urlopen=fake_urlopen(entries)).check_latest()

    assert result == {
        "currentVersion": "1.0.0",
        "latestVersion": "9.9.9",
        "available": True,
        "releaseNotes": ["测试更新"],
        "publishedAt": "2026-09-21",
    }


def test_positive_latest_cache_survives_restart_and_is_kept_on_manual_check_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = fixture_paths(tmp_path)
    monkeypatch.setattr("devtoolkit.update_manager.APP_VERSION", "1.0.0")
    entries = signed_feed(paths, [("KAITools.exe", b"new")])
    calls: list[str] = []

    def counting_urlopen(request: object, **kwargs: object) -> Response:
        calls.append(str(getattr(request, "full_url", request)))
        return fake_urlopen(entries)(request, **kwargs)

    first = UpdateManager(paths, urlopen=counting_urlopen).check_latest()
    cached_bytes = paths.latest_update_state_file.read_bytes()

    def offline_urlopen(*_args: object, **_kwargs: object) -> Response:
        raise OSError("offline")

    restarted_manager = UpdateManager(paths, urlopen=offline_urlopen)
    assert restarted_manager.check_latest() == first
    assert calls == [
        "https://updates.example.test/kaitools/latest.json",
        "https://updates.example.test/kaitools/latest.json.sig",
    ]

    with pytest.raises(UpdateError, match="无法检查更新") as error:
        restarted_manager.check_latest(force_refresh=True)

    assert error.value.code == "UPDATE_CHECK_FAILED"
    assert paths.latest_update_state_file.read_bytes() == cached_bytes


def test_invalid_manual_feed_signature_does_not_clear_a_verified_positive_cache(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = fixture_paths(tmp_path)
    monkeypatch.setattr("devtoolkit.update_manager.APP_VERSION", "1.0.0")
    entries = signed_feed(paths, [("KAITools.exe", b"new")])
    manager = UpdateManager(paths, urlopen=fake_urlopen(entries))
    manager.check_latest()
    cached_bytes = paths.latest_update_state_file.read_bytes()

    bad_entries = dict(entries)
    bad_entries["https://updates.example.test/kaitools/latest.json.sig"] = base64.b64encode(b"x" * 64)
    with pytest.raises(UpdateError, match="签名") as error:
        UpdateManager(paths, urlopen=fake_urlopen(bad_entries)).check_latest(force_refresh=True)

    assert error.value.code == "UPDATE_METADATA_INVALID"
    assert paths.latest_update_state_file.read_bytes() == cached_bytes


def test_tampered_cache_signature_is_rejected_and_replaced_from_signed_feed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = fixture_paths(tmp_path)
    monkeypatch.setattr("devtoolkit.update_manager.APP_VERSION", "1.0.0")
    entries = signed_feed(paths, [("KAITools.exe", b"new")])
    UpdateManager(paths, urlopen=fake_urlopen(entries)).check_latest()

    cached = json.loads(paths.latest_update_state_file.read_text(encoding="utf-8"))
    cached["signature"] = base64.b64encode(b"x" * 64).decode("ascii")
    paths.latest_update_state_file.write_text(json.dumps(cached), encoding="utf-8")

    result = UpdateManager(paths, urlopen=fake_urlopen(entries)).check_latest()

    assert result["available"] is True
    repaired = json.loads(paths.latest_update_state_file.read_text(encoding="utf-8"))
    assert repaired["signature"] != cached["signature"]


def test_negative_latest_cache_expires_after_24_hours_and_force_refresh_bypasses_it(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = fixture_paths(tmp_path)
    monkeypatch.setattr("devtoolkit.update_manager.APP_VERSION", "9.9.9")
    entries = signed_feed(paths, [("KAITools.exe", b"same")], version="9.9.9")
    calls: list[str] = []

    def counting_urlopen(request: object, **kwargs: object) -> Response:
        calls.append(str(getattr(request, "full_url", request)))
        return fake_urlopen(entries)(request, **kwargs)

    manager = UpdateManager(paths, urlopen=counting_urlopen)
    initial = manager.check_latest()
    assert initial["available"] is False
    assert len(calls) == 2
    assert manager.check_latest()["available"] is False
    assert len(calls) == 2

    cached = json.loads(paths.latest_update_state_file.read_text(encoding="utf-8"))
    old_time = datetime.now(timezone.utc) - timedelta(hours=24, seconds=1)
    cached["checkedAt"] = old_time.isoformat(timespec="seconds").replace("+00:00", "Z")
    paths.latest_update_state_file.write_text(json.dumps(cached), encoding="utf-8")
    assert manager.check_latest()["available"] is False
    assert len(calls) == 4

    assert manager.check_latest(force_refresh=True)["available"] is False
    assert len(calls) == 6


def test_reaching_cached_target_clears_old_badge_and_forces_a_fresh_check(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = fixture_paths(tmp_path)
    monkeypatch.setattr("devtoolkit.update_manager.APP_VERSION", "1.0.0")
    entries = signed_feed(paths, [("KAITools.exe", b"new")])
    UpdateManager(paths, urlopen=fake_urlopen(entries)).check_latest()
    assert json.loads(paths.latest_update_state_file.read_text(encoding="utf-8"))["currentVersion"] == "1.0.0"

    monkeypatch.setattr("devtoolkit.update_manager.APP_VERSION", "9.9.9")
    calls: list[str] = []

    def counting_urlopen(request: object, **kwargs: object) -> Response:
        calls.append(str(getattr(request, "full_url", request)))
        return fake_urlopen(entries)(request, **kwargs)

    result = UpdateManager(paths, urlopen=counting_urlopen).check_latest()

    assert result["available"] is False
    assert len(calls) == 2
    saved = json.loads(paths.latest_update_state_file.read_text(encoding="utf-8"))
    assert saved["currentVersion"] == "9.9.9"


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


def test_check_reports_the_path_for_a_zero_size_manifest_entry(tmp_path: Path) -> None:
    paths = fixture_paths(tmp_path)
    entries = signed_feed(paths, [("_internal/empty.bin", b"")])

    with pytest.raises(UpdateError, match=r"_internal/empty\.bin") as error:
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

    manager = UpdateManager(paths, urlopen=fake_urlopen(entries), process_launcher=launch)
    result = manager.start_install()

    assert result["restarting"] is False
    deadline = time.monotonic() + 5
    while manager.progress()["state"] not in {"ready-to-restart", "failed"} and time.monotonic() < deadline:
        time.sleep(0.02)
    assert manager.progress()["state"] == "ready-to-restart"
    restarted = manager.restart_install()
    assert restarted["restarting"] is True
    assert len(launched) == 1
    staged = list((paths.pending_dir / "updates").glob("*/staging/KAITools.exe"))
    assert len(staged) == 1 and staged[0].read_bytes() == b"new"
    assert not list((paths.pending_dir / "updates").glob("*/staging/data/**"))
    assert (paths.application_root / "data" / "settings.json").read_bytes() == b"keep"
