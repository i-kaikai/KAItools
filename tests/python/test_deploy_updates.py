from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "deploy-updates.sh"

pytestmark = pytest.mark.skipif(os.name == "nt", reason="桌面更新部署脚本只在 Linux 服务器执行")


def write_active_release(root: Path, release_id: str, objects: list[str]) -> Path:
    release = root / f".active-{release_id}"
    manifests = release / "manifests"
    object_root = release / "objects"
    manifests.mkdir(parents=True)
    object_root.mkdir()
    manifest_name = "KAITools-v1.4.20.json"
    (release / "latest.json").write_text(json.dumps({"manifest": f"manifests/{manifest_name}"}), encoding="utf-8")
    (manifests / manifest_name).write_text(
        json.dumps({"files": [{"object": f"objects/{digest}"} for digest in objects]}), encoding="utf-8"
    )
    (manifests / f"{manifest_name}.sig").write_text("signature", encoding="utf-8")
    for digest in objects:
        (object_root / digest).write_text("current", encoding="utf-8")
    return release


def run_script(root: Path, action: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(SCRIPT), action],
        env={**os.environ, "KAITOOLS_UPDATE_ROOT": str(root)},
        capture_output=True,
        text=True,
    )


def test_cleanup_removes_previous_active_data_and_legacy_layout(tmp_path: Path) -> None:
    root = tmp_path / "updates"
    current_release = write_active_release(root, "desktop-v1.4.20-0123456789ab", ["a" * 64])
    previous_release = write_active_release(root, "desktop-v1.4.19-fedcba987654", ["b" * 64])
    (root / "current").symlink_to(current_release)
    (root / ".previous").symlink_to(previous_release)
    (root / "releases").mkdir()
    (root / "releases" / "desktop-v1.4.18-old").mkdir()
    (root / "manifests").mkdir()
    (root / "manifests" / "old.json").write_text("stale", encoding="utf-8")
    (root / "objects").mkdir()
    (root / "objects" / ("b" * 64)).write_text("stale", encoding="utf-8")

    result = run_script(root, "cleanup")

    assert result.returncode == 0, result.stderr
    assert current_release.is_dir()
    assert not previous_release.exists()
    assert not (root / ".previous").exists()
    assert not (root / "releases").exists()
    assert not (root / "manifests").exists()
    assert not (root / "objects").exists()


def test_cleanup_rejects_a_current_link_outside_the_managed_root(tmp_path: Path) -> None:
    root = tmp_path / "updates"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (root / "current").symlink_to(outside)

    result = run_script(root, "cleanup")

    assert result.returncode != 0
    assert "managed link escapes update root" in result.stderr


def test_rollback_restores_previous_active_directory_and_removes_candidate(tmp_path: Path) -> None:
    root = tmp_path / "updates"
    current_release = write_active_release(root, "desktop-v1.4.20-0123456789ab", ["a" * 64])
    previous_release = write_active_release(root, "desktop-v1.4.19-fedcba987654", ["b" * 64])
    (root / "current").symlink_to(current_release)
    (root / ".previous").symlink_to(previous_release)

    result = run_script(root, "rollback")

    assert result.returncode == 0, result.stderr
    assert (root / "current").resolve() == previous_release.resolve()
    assert previous_release.is_dir()
    assert not current_release.exists()
    assert not (root / ".previous").exists()


def test_cleanup_rejects_a_legacy_directory_symbolic_link(tmp_path: Path) -> None:
    root = tmp_path / "updates"
    current_release = write_active_release(root, "desktop-v1.4.20-0123456789ab", ["a" * 64])
    (root / "current").symlink_to(current_release)
    outside_objects = tmp_path / "outside-objects"
    outside_objects.mkdir()
    sentinel = outside_objects / ("b" * 64)
    sentinel.write_text("retain", encoding="utf-8")
    (root / "objects").symlink_to(outside_objects)

    result = run_script(root, "cleanup")

    assert result.returncode != 0
    assert "legacy path escapes update root" in result.stderr
    assert sentinel.read_text(encoding="utf-8") == "retain"
