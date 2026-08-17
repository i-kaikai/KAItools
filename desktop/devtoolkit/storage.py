from __future__ import annotations

import copy
import json
import os
import tempfile
from pathlib import Path
from typing import Any

from .paths import AppPaths

SCHEMA_VERSION = 1
MAX_JSON_BYTES = 4 * 1024 * 1024
THEMES = {"system", "light", "dark"}
TOOL_IDS = {
    "json",
    "json-diff",
    "json-java",
    "java",
    "timestamp",
    "base64-text",
    "base64-image",
    "base64-file",
    "cron",
    "sql",
    "yaml",
    "xml",
    "text-diff",
    "text-stats",
    "md5",
    "hosts",
}

DEFAULT_SETTINGS: dict[str, Any] = {
    "schemaVersion": SCHEMA_VERSION,
    "theme": "system",
    "sidebarCollapsed": True,
}
DEFAULT_WORKSPACE: dict[str, Any] = {
    "schemaVersion": SCHEMA_VERSION,
    "tabs": [],
}
DEFAULT_HOSTS_PROFILES: dict[str, Any] = {
    "schemaVersion": SCHEMA_VERSION,
    "groups": [
        {
            "id": "default",
            "name": "开发环境",
            "enabled": True,
            "entries": [],
        }
    ],
}


class StorageError(RuntimeError):
    pass


def _json_size(value: Any) -> int:
    return len(json.dumps(value, ensure_ascii=False).encode("utf-8"))


def _read_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return copy.deepcopy(default)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise StorageError(f"无法读取配置文件：{path.name}") from exc
    if not isinstance(data, dict):
        raise StorageError(f"配置文件格式无效：{path.name}")
    if data.get("schemaVersion") in {None, 0}:
        migrated = copy.deepcopy(default)
        for key in default:
            if key != "schemaVersion" and key in data:
                migrated[key] = data[key]
        atomic_write_json(path, migrated)
        return migrated
    if data.get("schemaVersion") != SCHEMA_VERSION:
        raise StorageError(f"不支持的配置版本：{path.name}")
    return data


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    if _json_size(value) > MAX_JSON_BYTES:
        raise StorageError("保存内容超过 4 MB 限制")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


class AppStorage:
    def __init__(self, paths: AppPaths) -> None:
        self.paths = paths

    def ensure_directories(self) -> None:
        self.paths.data_root.mkdir(parents=True, exist_ok=True)
        self.paths.backups_dir.mkdir(parents=True, exist_ok=True)
        self.paths.pending_dir.mkdir(parents=True, exist_ok=True)
        self.paths.logs_dir.mkdir(parents=True, exist_ok=True)

    def load_all(self) -> dict[str, Any]:
        return {
            "settings": _read_json(self.paths.settings_file, DEFAULT_SETTINGS),
            "workspace": _read_json(self.paths.workspace_file, DEFAULT_WORKSPACE),
            "hostsProfiles": _read_json(
                self.paths.hosts_profiles_file, DEFAULT_HOSTS_PROFILES
            ),
        }

    def save_settings(self, payload: dict[str, Any]) -> None:
        allowed = {"settings", "hostsProfiles"}
        if set(payload) - allowed:
            raise StorageError("设置中包含不支持的字段")

        if "settings" in payload:
            settings = payload["settings"]
            if not isinstance(settings, dict):
                raise StorageError("设置格式无效")
            if set(settings) - {"schemaVersion", "theme", "sidebarCollapsed"}:
                raise StorageError("设置中包含不支持的字段")
            if settings.get("schemaVersion", SCHEMA_VERSION) != SCHEMA_VERSION:
                raise StorageError("设置版本无效")
            current = _read_json(self.paths.settings_file, DEFAULT_SETTINGS)
            update = {key: settings[key] for key in ("theme", "sidebarCollapsed") if key in settings}
            if "theme" in update and update["theme"] not in THEMES:
                raise StorageError("主题设置无效")
            if "sidebarCollapsed" in update and not isinstance(
                update["sidebarCollapsed"], bool
            ):
                raise StorageError("侧栏设置无效")
            current.update(update)
            current["schemaVersion"] = SCHEMA_VERSION
            atomic_write_json(self.paths.settings_file, current)

        if "hostsProfiles" in payload:
            profiles = payload["hostsProfiles"]
            if not isinstance(profiles, dict) or not isinstance(
                profiles.get("groups"), list
            ):
                raise StorageError("Hosts 分组格式无效")
            if set(profiles) - {"schemaVersion", "groups"}:
                raise StorageError("Hosts 分组中包含不支持的字段")
            if profiles.get("schemaVersion", SCHEMA_VERSION) != SCHEMA_VERSION:
                raise StorageError("Hosts 分组版本无效")
            value = {
                "schemaVersion": SCHEMA_VERSION,
                "groups": profiles["groups"],
            }
            atomic_write_json(self.paths.hosts_profiles_file, value)

    def save_workspace(self, payload: dict[str, Any]) -> None:
        tabs = payload.get("tabs")
        if set(payload) - {"tabs"} or not isinstance(tabs, list):
            raise StorageError("工作台格式无效")
        if len(tabs) > 50:
            raise StorageError("固定标签不能超过 50 个")
        sanitized: list[dict[str, Any]] = []
        for tab in tabs:
            if not isinstance(tab, dict):
                raise StorageError("标签格式无效")
            if set(tab) - {"id", "toolId", "title", "pinned", "state"}:
                raise StorageError("固定标签包含不支持的字段")
            if tab.get("toolId") not in TOOL_IDS or tab.get("pinned") is not True:
                raise StorageError("固定标签包含无效工具")
            tab_id = tab.get("id")
            title = tab.get("title")
            if not isinstance(tab_id, str) or not 1 <= len(tab_id) <= 80:
                raise StorageError("标签标识无效")
            if not isinstance(title, str) or not 1 <= len(title) <= 80:
                raise StorageError("标签标题无效")
            state = tab.get("state", {})
            if not isinstance(state, dict):
                raise StorageError("固定标签状态格式无效")
            if _json_size(state) > 2 * 1024 * 1024:
                raise StorageError("单个标签内容超过 2 MB 限制")
            sanitized.append(
                {
                    "id": tab_id,
                    "toolId": tab["toolId"],
                    "title": title,
                    "pinned": True,
                    "state": state,
                }
            )
        atomic_write_json(
            self.paths.workspace_file,
            {"schemaVersion": SCHEMA_VERSION, "tabs": sanitized},
        )
