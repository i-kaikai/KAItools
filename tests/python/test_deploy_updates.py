from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "deploy-updates.sh"

pytestmark = pytest.mark.skipif(os.name == "nt", reason="桌面更新部署脚本只在 Linux 服务器执行")


def write_release(root: Path, release_id: str, objects: list[str]) -> Path:
    release = root / "releases" / release_id
    manifests = release / "manifests"
    object_root = release / "objects"
    manifests.mkdir(parents=True)
    object_root.mkdir()
    manifest_name = "KAITools-v1.4.19.json"
    (release / "latest.json").write_text(json.dumps({"manifest": f"manifests/{manifest_name}"}), encoding="utf-8")
    (manifests / manifest_name).write_text(
        json.dumps({"files": [{"object": f"objects/{digest}"} for digest in objects]}), encoding="utf-8"
    )
    (manifests / f"{manifest_name}.sig").write_text("signature", encoding="utf-8")
    for digest in objects:
        (object_root / digest).write_text("current", encoding="utf-8")
    return release


def test_cleanup_removes_only_historical_desktop_update_data(tmp_path: Path) -> None:
    root = tmp_path / "updates"
    current_digest = "a" * 64
    stale_digest = "b" * 64
    current_release = write_release(root, "desktop-v1.4.19-0123456789ab", [current_digest])
    stale_release = write_release(root, "desktop-v1.4.18-fedcba987654", [stale_digest])
    (root / "current").symlink_to(current_release)
    root_manifests = root / "manifests"
    root_manifests.mkdir()
    (root_manifests / "KAITools-v1.4.19.json").write_text("current", encoding="utf-8")
    (root_manifests / "KAITools-v1.4.19.json.sig").write_text("signature", encoding="utf-8")
    (root_manifests / "KAITools-v1.4.18.json").write_text("stale", encoding="utf-8")
    (root_manifests / "KAITools-v1.4.18.json.sig").write_text("signature", encoding="utf-8")
    root_objects = root / "objects"
    root_objects.mkdir()
    (root_objects / current_digest).write_text("current", encoding="utf-8")
    (root_objects / stale_digest).write_text("stale", encoding="utf-8")
    incoming = root / ".incoming"
    incoming.mkdir()
    stale_incoming = incoming / ".desktop-v1.4.18-fedcba987654.artifact-stale"
    stale_incoming.mkdir()
    retained_incoming = incoming / "operator-notes"
    retained_incoming.write_text("retain", encoding="utf-8")

    result = subprocess.run(
        ["bash", str(SCRIPT), "cleanup"],
        env={**os.environ, "KAITOOLS_UPDATE_ROOT": str(root)},
        capture_output=True,
        check=True,
        text=True,
    )

    assert "UPDATE_CLEANUP_OK releases=1 manifests=2 objects=1 incoming=1" in result.stdout
    assert current_release.is_dir()
    assert not stale_release.exists()
    assert sorted(path.name for path in root_manifests.iterdir()) == ["KAITools-v1.4.19.json", "KAITools-v1.4.19.json.sig"]
    assert sorted(path.name for path in root_objects.iterdir()) == [current_digest]
    assert not stale_incoming.exists()
    assert retained_incoming.read_text(encoding="utf-8") == "retain"


def test_cleanup_rejects_a_current_link_outside_the_managed_release_root(tmp_path: Path) -> None:
    root = tmp_path / "updates"
    root.mkdir()
    (root / "releases").mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (root / "current").symlink_to(outside)

    result = subprocess.run(
        ["bash", str(SCRIPT), "cleanup"],
        env={**os.environ, "KAITOOLS_UPDATE_ROOT": str(root)},
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "current release is outside the managed releases directory" in result.stderr


def test_idempotent_deploy_also_removes_historical_releases(tmp_path: Path) -> None:
    root = tmp_path / "updates"
    release_id = "desktop-v1.4.19-0123456789ab"
    current_release = write_release(root, release_id, ["a" * 64])
    stale_release = write_release(root, "desktop-v1.4.18-fedcba987654", ["b" * 64])
    (root / "current").symlink_to(current_release)

    result = subprocess.run(
        ["bash", str(SCRIPT), "deploy"],
        env={**os.environ, "KAITOOLS_UPDATE_ROOT": str(root), "KAITOOLS_UPDATE_RELEASE_ID": release_id},
        capture_output=True,
        check=True,
        text=True,
    )

    assert "Desktop update release desktop-v1.4.19-0123456789ab is already active" in result.stdout
    assert "UPDATE_CLEANUP_OK releases=1" in result.stdout
    assert not stale_release.exists()


def test_cleanup_rejects_a_managed_directory_symbolic_link(tmp_path: Path) -> None:
    root = tmp_path / "updates"
    current_release = write_release(root, "desktop-v1.4.19-0123456789ab", ["a" * 64])
    (root / "current").symlink_to(current_release)
    outside_objects = tmp_path / "outside-objects"
    outside_objects.mkdir()
    sentinel = outside_objects / ("b" * 64)
    sentinel.write_text("retain", encoding="utf-8")
    (root / "objects").symlink_to(outside_objects)

    result = subprocess.run(
        ["bash", str(SCRIPT), "cleanup"],
        env={**os.environ, "KAITOOLS_UPDATE_ROOT": str(root)},
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "managed update path must not be a symbolic link: objects" in result.stderr
    assert sentinel.read_text(encoding="utf-8") == "retain"
