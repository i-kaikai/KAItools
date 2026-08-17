from __future__ import annotations

import json
from pathlib import Path

import pytest

from devtoolkit.paths import AppPaths
from devtoolkit.storage import AppStorage, StorageError


def paths(tmp_path: Path) -> AppPaths:
    return AppPaths(tmp_path, tmp_path / "resources", tmp_path / "data")


def test_default_settings_start_with_collapsed_sidebar(tmp_path: Path) -> None:
    storage = AppStorage(paths(tmp_path))
    storage.ensure_directories()

    assert storage.load_all()["settings"] == {
        "schemaVersion": 1,
        "theme": "system",
        "sidebarCollapsed": True,
    }


def test_storage_round_trip_and_schema(tmp_path: Path) -> None:
    storage = AppStorage(paths(tmp_path))
    storage.ensure_directories()
    storage.save_settings({"settings": {"theme": "dark", "sidebarCollapsed": True}})
    storage.save_workspace(
        {
            "tabs": [
                {
                    "id": "json-1",
                    "toolId": "json",
                    "title": "JSON",
                    "pinned": True,
                    "state": {"input": '{"ok":true}'},
                },
                {
                    "id": "cron-1",
                    "toolId": "cron",
                    "title": "Crontab 生成器",
                    "pinned": True,
                    "state": {"expression": "0 9 * * 1-5", "timeZone": "Asia/Shanghai"},
                },
            ]
        }
    )

    state = storage.load_all()
    assert state["settings"]["theme"] == "dark"
    assert state["workspace"]["tabs"][0]["state"]["input"] == '{"ok":true}'
    assert state["workspace"]["tabs"][1]["toolId"] == "cron"
    assert json.loads((tmp_path / "data" / "settings.json").read_text("utf-8"))["schemaVersion"] == 1


def test_storage_rejects_unknown_and_oversized_content(tmp_path: Path) -> None:
    storage = AppStorage(paths(tmp_path))
    storage.ensure_directories()
    with pytest.raises(StorageError):
        storage.save_settings({"unknown": {}})
    with pytest.raises(StorageError):
        storage.save_settings({"settings": {"theme": "dark", "unexpected": True}})
    with pytest.raises(StorageError):
        storage.save_settings({"hostsProfiles": {"groups": [], "unexpected": True}})
    with pytest.raises(StorageError):
        storage.save_workspace(
            {
                "tabs": [
                    {
                        "id": "json-1",
                        "toolId": "json",
                        "title": "JSON",
                        "pinned": True,
                        "state": {"input": "x" * (2 * 1024 * 1024 + 1)},
                    }
                ]
            }
        )
    with pytest.raises(StorageError):
        storage.save_workspace(
            {
                "tabs": [
                    {
                        "id": "json-1",
                        "toolId": "json",
                        "title": "JSON",
                        "pinned": True,
                        "state": "not-an-object",
                    }
                ]
            }
        )


def test_corrupt_configuration_is_reported(tmp_path: Path) -> None:
    storage = AppStorage(paths(tmp_path))
    storage.ensure_directories()
    storage.paths.settings_file.write_text("{broken", encoding="utf-8")
    with pytest.raises(StorageError):
        storage.load_all()


def test_legacy_configuration_is_migrated_atomically(tmp_path: Path) -> None:
    storage = AppStorage(paths(tmp_path))
    storage.ensure_directories()
    storage.paths.settings_file.write_text(
        json.dumps({"theme": "dark", "sidebarCollapsed": True, "obsolete": "ignored"}),
        encoding="utf-8",
    )

    settings = storage.load_all()["settings"]
    persisted = json.loads(storage.paths.settings_file.read_text(encoding="utf-8"))

    assert settings == {"schemaVersion": 1, "theme": "dark", "sidebarCollapsed": True}
    assert persisted == settings
    assert not list(storage.paths.data_root.glob("*.tmp"))
