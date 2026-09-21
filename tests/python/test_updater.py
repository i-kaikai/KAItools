from __future__ import annotations

import json
from pathlib import Path

import devtoolkit.updater as updater
from devtoolkit.update_security import sha256_bytes


def request_for(tmp_path: Path, content: bytes) -> tuple[Path, str, Path, Path]:
    application = tmp_path / "KAITools"
    staging = tmp_path / "staging"
    pending = tmp_path / "pending"
    (application / "data").mkdir(parents=True)
    staging.mkdir(parents=True)
    (application / "KAITools.exe").write_bytes(b"old")
    (application / "data" / "notes.json").write_bytes(b"user notes")
    (staging / "KAITools.exe").write_bytes(content)
    (staging / "app-manifest.json").write_bytes(b'{"version":"9.9.9"}')
    request = {
        "schemaVersion": 1,
        "applicationRoot": str(application),
        "dataRoot": str(application / "data"),
        "mainExecutable": "KAITools.exe",
        "targetVersion": "9.9.9",
        "parentPid": 1,
        "stagingRoot": str(staging),
        "healthPath": str(pending / "health.json"),
        "resultPath": str(pending / "result.json"),
        "files": [
            {"path": "KAITools.exe", "sha256": sha256_bytes(content), "size": len(content)},
            {"path": "app-manifest.json", "sha256": sha256_bytes(b'{"version":"9.9.9"}'), "size": len(b'{"version":"9.9.9"}')},
        ],
        "deletePaths": [],
    }
    request_path = pending / "request.json"
    request_path.parent.mkdir(parents=True)
    raw = json.dumps(request, separators=(",", ":")).encode("utf-8")
    request_path.write_bytes(raw)
    return request_path, sha256_bytes(raw), application, pending


def test_updater_replaces_program_files_and_preserves_data(tmp_path: Path, monkeypatch) -> None:
    request_path, digest, application, pending = request_for(tmp_path, b"new")
    monkeypatch.setattr(updater, "_wait_for_parent", lambda _pid: None)
    monkeypatch.setattr(updater, "_wait_for_health", lambda _path, _version: True)
    monkeypatch.setattr(updater.subprocess, "Popen", lambda *_args, **_kwargs: object())

    assert updater.apply_update(request_path, digest) == 0
    assert (application / "KAITools.exe").read_bytes() == b"new"
    assert (application / "data" / "notes.json").read_bytes() == b"user notes"
    assert json.loads((pending / "result.json").read_text(encoding="utf-8"))["ok"] is True


def test_updater_rolls_back_when_a_replacement_fails(tmp_path: Path, monkeypatch) -> None:
    request_path, digest, application, pending = request_for(tmp_path, b"new")
    monkeypatch.setattr(updater, "_wait_for_parent", lambda _pid: None)
    monkeypatch.setattr(updater, "_copy_replacement", lambda *_args: (_ for _ in ()).throw(OSError("write failed")))
    monkeypatch.setattr(updater.subprocess, "Popen", lambda *_args, **_kwargs: object())

    assert updater.apply_update(request_path, digest) == 1
    assert (application / "KAITools.exe").read_bytes() == b"old"
    assert (application / "data" / "notes.json").read_bytes() == b"user notes"
    assert json.loads((pending / "result.json").read_text(encoding="utf-8"))["ok"] is False
