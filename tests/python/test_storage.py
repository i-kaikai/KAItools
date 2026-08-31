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
        "locale": "zh-CN",
        "theme": "system",
        "sidebarCollapsed": True,
        "particleQuality": "high",
        "motionMode": "system",
        "sidebarStartup": "remember",
        "restorePinnedTabsOnLaunch": True,
        "editorFontSize": 13,
        "editorLineWrapping": True,
        "clipboardMonitoringEnabled": True,
        "systemStatusRefreshSeconds": 1,
        "systemStatusRefreshMigrationVersion": 1,
        "developerModeEnabled": False,
        "activationHotkey": "Ctrl+Alt+K",
    }
    assert storage.paths.webview_profile_dir.is_dir()
    assert len(storage.load_all()["dashboardCards"]["cards"]) == 6
    assert storage.load_all()["dashboardCards"]["carouselMode"] == "step"
    assert storage.load_all()["dashboardCards"]["classicRotationSpeed"] == 16
    assert storage.load_all()["dashboardCards"]["stepIntervalMs"] == 1600


def test_storage_round_trip_and_schema(tmp_path: Path) -> None:
    storage = AppStorage(paths(tmp_path))
    storage.ensure_directories()
    storage.save_settings({
        "settings": {
            "locale": "en-US",
            "theme": "dark",
            "sidebarCollapsed": True,
            "particleQuality": "balanced",
            "motionMode": "reduced",
            "sidebarStartup": "expanded",
            "restorePinnedTabsOnLaunch": False,
                "editorFontSize": 16,
                "editorLineWrapping": False,
                "clipboardMonitoringEnabled": False,
                "systemStatusRefreshSeconds": 60,
                "systemStatusRefreshMigrationVersion": 1,
            "activationHotkey": "ctrl+alt+f8",
        },
        "backendConnection": {"schemaVersion": 1, "localApiOrigin": "http://127.0.0.1:8080", "useLocalApi": True},
    })
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
    assert state["settings"]["activationHotkey"] == "Ctrl+Alt+F8"
    assert state["settings"] == {
        "schemaVersion": 1,
        "locale": "en-US",
        "theme": "dark",
        "sidebarCollapsed": True,
        "particleQuality": "balanced",
        "motionMode": "reduced",
        "sidebarStartup": "expanded",
        "restorePinnedTabsOnLaunch": False,
            "editorFontSize": 16,
            "editorLineWrapping": False,
            "clipboardMonitoringEnabled": False,
            "systemStatusRefreshSeconds": 60,
            "systemStatusRefreshMigrationVersion": 1,
        "developerModeEnabled": False,
        "activationHotkey": "Ctrl+Alt+F8",
    }
    assert state["backendConnection"] == {"schemaVersion": 1, "localApiOrigin": "http://127.0.0.1:8080", "useLocalApi": False}
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
        storage.save_settings({"settings": {"particleQuality": "ultra"}})


    with pytest.raises(StorageError):
        storage.save_settings({"settings": {"locale": "fr-FR"}})
    with pytest.raises(StorageError):
        storage.save_settings({"settings": {"editorFontSize": 17}})
    with pytest.raises(StorageError):
        storage.save_settings({"hostsProfiles": {"groups": [], "unexpected": True}})
    with pytest.raises(StorageError):
        storage.save_settings({"dashboardCards": {"cards": [{"id": "bad", "toolId": "json"}]}})
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


def test_document_tools_are_valid_persistent_workspace_and_shortcut_ids(tmp_path: Path) -> None:
    storage = AppStorage(paths(tmp_path))
    storage.ensure_directories()
    document_tools = ["html-pdf", "word-pdf", "pdf-word"]

    storage.save_settings({"sidebarShortcuts": {"schemaVersion": 1, "toolIds": document_tools}})
    storage.save_workspace(
        {
            "tabs": [
                {"id": f"{tool_id}-1", "toolId": tool_id, "title": tool_id, "pinned": True, "state": {"kind": tool_id}}
                for tool_id in document_tools
            ]
        }
    )

    state = storage.load_all()
    assert state["sidebarShortcuts"]["toolIds"] == document_tools
    assert [tab["toolId"] for tab in state["workspace"]["tabs"]] == document_tools


def test_dashboard_cards_round_trip_as_local_structured_settings(tmp_path: Path) -> None:
    storage = AppStorage(paths(tmp_path))
    storage.ensure_directories()
    cards = {
        "schemaVersion": 1,
        "carouselMode": "classic",
        "classicRotationSpeed": 22,
        "stepIntervalMs": 2400,
        "cards": [
            {
                "id": "dashboard-json",
                "toolId": "json",
                "title": "快捷 JSON",
                "description": "格式化接口数据",
                "accentColor": "#35D0A7",
                "sortOrder": 99,
                "enabled": True,
            }
        ],
    }

    storage.save_settings({"dashboardCards": cards})

    assert storage.load_all()["dashboardCards"] == {
        "schemaVersion": 1,
        "carouselMode": "classic",
        "classicRotationSpeed": 22,
        "stepIntervalMs": 2400,
        "cards": [{**cards["cards"][0], "accentColor": "#35d0a7", "sortOrder": 0}],
    }


def test_legacy_dashboard_cards_default_to_step_mode(tmp_path: Path) -> None:
    storage = AppStorage(paths(tmp_path))
    storage.ensure_directories()
    storage.paths.dashboard_cards_file.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "cards": [
                    {
                        "id": "legacy-json",
                        "toolId": "json",
                        "title": "JSON",
                        "description": "格式化 JSON",
                        "accentColor": "#35d0a7",
                        "sortOrder": 0,
                        "enabled": True,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    assert storage.load_all()["dashboardCards"]["carouselMode"] == "step"
    assert storage.load_all()["dashboardCards"]["classicRotationSpeed"] == 16
    assert storage.load_all()["dashboardCards"]["stepIntervalMs"] == 1600


def test_dashboard_cards_reject_more_than_six_registered_tools(tmp_path: Path) -> None:
    storage = AppStorage(paths(tmp_path))
    storage.ensure_directories()
    tool_ids = ["json", "java", "timestamp", "base64-text", "cron", "notes", "json-diff"]
    cards = {
        "schemaVersion": 1,
        "carouselMode": "step",
        "classicRotationSpeed": 16,
        "stepIntervalMs": 1600,
        "cards": [
            {
                "id": f"dashboard-{tool_id}",
                "toolId": tool_id,
                "title": tool_id,
                "description": tool_id,
                "accentColor": "#35d0a7",
                "sortOrder": index,
                "enabled": True,
            }
            for index, tool_id in enumerate(tool_ids)
        ],
    }

    with pytest.raises(StorageError):
        storage.save_settings({"dashboardCards": cards})


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

    assert settings == {
        "schemaVersion": 1,
        "locale": "zh-CN",
        "theme": "dark",
        "sidebarCollapsed": True,
        "particleQuality": "high",
        "motionMode": "system",
        "sidebarStartup": "remember",
        "restorePinnedTabsOnLaunch": True,
        "editorFontSize": 13,
        "editorLineWrapping": True,
        "clipboardMonitoringEnabled": True,
        "systemStatusRefreshSeconds": 1,
        "systemStatusRefreshMigrationVersion": 1,
        "developerModeEnabled": False,
        "activationHotkey": "Ctrl+Alt+K",
    }
    assert persisted == settings
    assert not list(storage.paths.data_root.glob("*.tmp"))


def test_legacy_manual_status_refresh_migrates_once_then_remains_user_configurable(tmp_path: Path) -> None:
    storage = AppStorage(paths(tmp_path))
    storage.ensure_directories()
    storage.paths.settings_file.write_text(
        json.dumps({"schemaVersion": 1, "systemStatusRefreshSeconds": 0}),
        encoding="utf-8",
    )

    migrated = storage.load_all()["settings"]
    assert migrated["systemStatusRefreshSeconds"] == 1
    assert migrated["systemStatusRefreshMigrationVersion"] == 1

    storage.save_settings({"settings": {"systemStatusRefreshSeconds": 0, "systemStatusRefreshMigrationVersion": 1}})
    assert storage.load_all()["settings"]["systemStatusRefreshSeconds"] == 0


def test_legacy_loopback_connection_becomes_developer_only_override(tmp_path: Path) -> None:
    storage = AppStorage(paths(tmp_path))
    storage.ensure_directories()
    storage.paths.backend_connection_file.write_text(
        json.dumps({"schemaVersion": 1, "apiOrigin": "http://127.0.0.1:8080"}),
        encoding="utf-8",
    )

    regular_state = storage.load_all()
    assert regular_state["backendConnection"] == {
        "schemaVersion": 1,
        "localApiOrigin": "http://127.0.0.1:8080",
        "useLocalApi": False,
    }

    storage.paths.settings_file.write_text(
        json.dumps({"schemaVersion": 1, "theme": "system", "sidebarCollapsed": True, "developerModeEnabled": True, "activationHotkey": "Ctrl+Alt+K"}),
        encoding="utf-8",
    )
    storage.paths.backend_connection_file.write_text(
        json.dumps({"schemaVersion": 1, "apiOrigin": "http://127.0.0.1:8080"}),
        encoding="utf-8",
    )

    developer_state = storage.load_all()
    assert developer_state["backendConnection"]["useLocalApi"] is True


def test_notes_are_confined_to_managed_markdown_files(tmp_path: Path) -> None:
    storage = AppStorage(paths(tmp_path))
    storage.ensure_directories()
    notes = storage.load_notes()
    notes["notes"][0]["content"] = "# 本地笔记\n\n内容"
    storage.save_notes(notes)

    loaded = storage.load_notes()

    assert loaded["notes"][0]["content"] == "# 本地笔记\n\n内容"
    assert (storage.paths.notes_dir / "about-kaitools.md").is_file()
    assert not any(path.suffix == ".md" and path.parent != storage.paths.notes_dir for path in storage.paths.data_root.rglob("*.md"))


def test_notes_reject_unmanaged_identifiers(tmp_path: Path) -> None:
    storage = AppStorage(paths(tmp_path))
    storage.ensure_directories()
    notes = storage.load_notes()
    notes["notes"][0]["id"] = "../outside"

    with pytest.raises(StorageError):
        storage.save_notes(notes)
