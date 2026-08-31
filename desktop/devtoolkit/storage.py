from __future__ import annotations

import copy
import json
import os
import tempfile
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .hotkeys import DEFAULT_ACTIVATION_HOTKEY, HotkeyError, normalize_activation_hotkey
from .paths import AppPaths

SCHEMA_VERSION = 1
MAX_JSON_BYTES = 4 * 1024 * 1024
THEMES = {"system", "light", "dark"}
PARTICLE_QUALITIES = {"high", "balanced", "off"}
MOTION_MODES = {"system", "reduced"}
SIDEBAR_STARTUP_MODES = {"remember", "collapsed", "expanded"}
APP_LOCALES = {"zh-CN", "en-US"}
SYSTEM_STATUS_REFRESH_INTERVALS = {0, 1, 30, 60, 300}
SYSTEM_STATUS_REFRESH_MIGRATION_VERSION = 1
TOOL_IDS = {
    "json",
    "json-diff",
    "json-java",
    "java",
    "timestamp",
    "base64-text",
    "base64-image",
    "base64-file",
    "qrcode",
    "image-studio",
    "video-audio",
    "html-pdf",
    "word-pdf",
    "pdf-word",
    "cron",
    "sql",
    "yaml",
    "xml",
    "text-diff",
    "text-stats",
    "regex",
    "md5",
    "naming",
    "identifiers",
    "hosts",
    "notes",
    "clipboard-history",
    "calculator",
}

DEFAULT_SETTINGS: dict[str, Any] = {
    "schemaVersion": SCHEMA_VERSION,
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
    "systemStatusRefreshMigrationVersion": SYSTEM_STATUS_REFRESH_MIGRATION_VERSION,
    "developerModeEnabled": False,
    "activationHotkey": DEFAULT_ACTIVATION_HOTKEY,
}
DEFAULT_BACKEND_CONNECTION: dict[str, Any] = {
    "schemaVersion": SCHEMA_VERSION,
    "localApiOrigin": "http://127.0.0.1:8080",
    "useLocalApi": False,
}
DEFAULT_WORKSPACE: dict[str, Any] = {
    "schemaVersion": SCHEMA_VERSION,
    "tabs": [],
}
DEFAULT_SIDEBAR_SHORTCUTS: dict[str, Any] = {
    "schemaVersion": SCHEMA_VERSION,
    "toolIds": ["notes", "json", "calculator", "java", "timestamp", "base64-text", "cron", "hosts", "clipboard-history", "md5"],
}
DEFAULT_SHORTCUT_SYNC: dict[str, Any] = {
    "schemaVersion": SCHEMA_VERSION,
    "accountId": None,
    "mode": "pending",
    "revision": None,
    "pendingToolIds": None,
}
DEFAULT_DASHBOARD_CARDS: dict[str, Any] = {
    "schemaVersion": SCHEMA_VERSION,
    "carouselMode": "step",
    "classicRotationSpeed": 16,
    "stepIntervalMs": 1600,
    "cards": [
        {"id": "system-json", "toolId": "json", "title": "JSON", "description": "格式化、压缩与关系图", "accentColor": "#35d0a7", "sortOrder": 0, "enabled": True},
        {"id": "system-java", "toolId": "java", "title": "Java 转义", "description": "字符串转义与反转义", "accentColor": "#ff7d5d", "sortOrder": 1, "enabled": True},
        {"id": "system-timestamp", "toolId": "timestamp", "title": "日期转换", "description": "多格式日期与时间戳转换", "accentColor": "#6ea0ff", "sortOrder": 2, "enabled": True},
        {"id": "system-base64-text", "toolId": "base64-text", "title": "Base64 文本", "description": "UTF-8 文本编码与解码", "accentColor": "#dcad49", "sortOrder": 3, "enabled": True},
        {"id": "system-cron", "toolId": "cron", "title": "Crontab", "description": "生成并校验 Cron 表达式", "accentColor": "#6eb9ff", "sortOrder": 4, "enabled": True},
        {"id": "system-notes", "toolId": "notes", "title": "笔记", "description": "Markdown 本地笔记", "accentColor": "#a58df0", "sortOrder": 5, "enabled": True},
    ],
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
DEFAULT_NOTES: dict[str, Any] = {
    "schemaVersion": SCHEMA_VERSION,
    "notebooks": [
        {
            "id": "kaitools-notebook",
            "name": "开始使用",
            "sortOrder": 0,
            "createdAt": "2026-08-21T00:00:00Z",
            "updatedAt": "2026-08-21T00:00:00Z",
        }
    ],
    "folders": [],
    "notes": [
        {
            "id": "about-kaitools",
            "notebookId": "kaitools-notebook",
            "folderId": None,
            "title": "关于 KAITools",
            "pinned": True,
            "revision": 1,
            "syncStatus": "local",
            "sortOrder": 0,
            "createdAt": "2026-08-21T00:00:00Z",
            "updatedAt": "2026-08-21T00:00:00Z",
        }
    ],
}
DEFAULT_NOTE_CONTENT = """# KAI\n\n## Keep Approaching Ideal\n\n始终靠近理想\n\nKAITools 是面向开发者的本地优先工具空间。JSON、编码、时间、系统配置和笔记都先在当前设备完成处理；只有你主动登录并启用同步时，笔记、偏好与快捷方式才会进入服务端工作区。\n\n把这里当作产品说明、开发备忘录，或你的下一条想法。\n"""
NOTE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")


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


def _read_dashboard_cards(path: Path) -> dict[str, Any]:
    cards = _read_json(path, DEFAULT_DASHBOARD_CARDS)
    changed = False
    if cards.get("cards") == []:
        cards = copy.deepcopy(DEFAULT_DASHBOARD_CARDS)
        changed = True
    else:
        if len(cards.get("cards", [])) > 6:
            cards["cards"] = cards["cards"][:6]
            changed = True
        if cards.get("carouselMode") not in {"classic", "step"}:
            cards["carouselMode"] = "step"
            changed = True
        if not isinstance(cards.get("classicRotationSpeed"), int) or not 6 <= cards["classicRotationSpeed"] <= 30:
            cards["classicRotationSpeed"] = 16
            changed = True
        if not isinstance(cards.get("stepIntervalMs"), int) or not 800 <= cards["stepIntervalMs"] <= 6000:
            cards["stepIntervalMs"] = 1600
            changed = True
    if changed:
        atomic_write_json(path, cards)
    return cards


def _read_settings(path: Path) -> dict[str, Any]:
    """Migrate device settings without making a schema-version bump necessary."""

    settings = _read_json(path, DEFAULT_SETTINGS)
    changed = False
    needs_status_refresh_migration = settings.get("systemStatusRefreshMigrationVersion") != SYSTEM_STATUS_REFRESH_MIGRATION_VERSION
    for key, default in DEFAULT_SETTINGS.items():
        if key == "schemaVersion" or key in settings:
            continue
        settings[key] = copy.deepcopy(default)
        changed = True
    if settings.get("theme") not in THEMES:
        settings["theme"] = DEFAULT_SETTINGS["theme"]
        changed = True
    if settings.get("locale") not in APP_LOCALES:
        settings["locale"] = DEFAULT_SETTINGS["locale"]
        changed = True
    if not isinstance(settings.get("sidebarCollapsed"), bool):
        settings["sidebarCollapsed"] = DEFAULT_SETTINGS["sidebarCollapsed"]
        changed = True
    if settings.get("particleQuality") not in PARTICLE_QUALITIES:
        settings["particleQuality"] = DEFAULT_SETTINGS["particleQuality"]
        changed = True
    if settings.get("motionMode") not in MOTION_MODES:
        settings["motionMode"] = DEFAULT_SETTINGS["motionMode"]
        changed = True
    if settings.get("sidebarStartup") not in SIDEBAR_STARTUP_MODES:
        settings["sidebarStartup"] = DEFAULT_SETTINGS["sidebarStartup"]
        changed = True
    if not isinstance(settings.get("restorePinnedTabsOnLaunch"), bool):
        settings["restorePinnedTabsOnLaunch"] = DEFAULT_SETTINGS["restorePinnedTabsOnLaunch"]
        changed = True
    if not isinstance(settings.get("editorFontSize"), int) or not 12 <= settings["editorFontSize"] <= 16:
        settings["editorFontSize"] = DEFAULT_SETTINGS["editorFontSize"]
        changed = True
    if not isinstance(settings.get("editorLineWrapping"), bool):
        settings["editorLineWrapping"] = DEFAULT_SETTINGS["editorLineWrapping"]
        changed = True
    if not isinstance(settings.get("clipboardMonitoringEnabled"), bool):
        settings["clipboardMonitoringEnabled"] = DEFAULT_SETTINGS["clipboardMonitoringEnabled"]
        changed = True
    if not isinstance(settings.get("systemStatusRefreshSeconds"), int) or settings["systemStatusRefreshSeconds"] not in SYSTEM_STATUS_REFRESH_INTERVALS:
        settings["systemStatusRefreshSeconds"] = DEFAULT_SETTINGS["systemStatusRefreshSeconds"]
        changed = True
    if needs_status_refresh_migration:
        if settings["systemStatusRefreshSeconds"] == 0:
            settings["systemStatusRefreshSeconds"] = DEFAULT_SETTINGS["systemStatusRefreshSeconds"]
        settings["systemStatusRefreshMigrationVersion"] = SYSTEM_STATUS_REFRESH_MIGRATION_VERSION
        changed = True
    if not isinstance(settings.get("developerModeEnabled"), bool):
        settings["developerModeEnabled"] = DEFAULT_SETTINGS["developerModeEnabled"]
        changed = True
    if not isinstance(settings.get("activationHotkey"), str):
        settings["activationHotkey"] = DEFAULT_ACTIVATION_HOTKEY
        changed = True
    else:
        try:
            normalized = normalize_activation_hotkey(settings["activationHotkey"])
        except HotkeyError:
            normalized = DEFAULT_ACTIVATION_HOTKEY
        if settings["activationHotkey"] != normalized:
            settings["activationHotkey"] = normalized
            changed = True
    if changed:
        atomic_write_json(path, settings)
    return settings


def _is_loopback_api_origin(value: object) -> bool:
    if not isinstance(value, str) or not 1 <= len(value) <= 200:
        return False
    try:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            return False
        if parsed.username or parsed.password or parsed.params or parsed.query or parsed.fragment:
            return False
        if parsed.path not in {"", "/"}:
            return False
        _ = parsed.port
        return True
    except ValueError:
        return False


def _read_backend_connection(path: Path, developer_mode_enabled: bool) -> dict[str, Any]:
    """Migrate the old global API setting into a developer-only loopback override."""

    connection = _read_json(path, DEFAULT_BACKEND_CONNECTION)
    legacy_origin = connection.get("apiOrigin")
    local_origin = connection.get("localApiOrigin")
    resolved_local_origin = local_origin if _is_loopback_api_origin(local_origin) else (
        legacy_origin if _is_loopback_api_origin(legacy_origin) else DEFAULT_BACKEND_CONNECTION["localApiOrigin"]
    )
    use_local = developer_mode_enabled and (
        connection.get("useLocalApi") is True or "apiOrigin" in connection and _is_loopback_api_origin(legacy_origin)
    )
    migrated = {
        "schemaVersion": SCHEMA_VERSION,
        "localApiOrigin": resolved_local_origin,
        "useLocalApi": use_local,
    }
    if connection != migrated:
        atomic_write_json(path, migrated)
    return migrated


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


def atomic_write_text(path: Path, value: str) -> None:
    if len(value.encode("utf-8")) > MAX_JSON_BYTES:
        raise StorageError("笔记内容超过 4 MB 限制")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(value)
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
        self.paths.notes_dir.mkdir(parents=True, exist_ok=True)
        self.paths.webview_profile_dir.mkdir(parents=True, exist_ok=True)

    def load_all(self) -> dict[str, Any]:
        settings = _read_settings(self.paths.settings_file)
        return {
            "settings": settings,
            "backendConnection": _read_backend_connection(
                self.paths.backend_connection_file,
                settings.get("developerModeEnabled") is True,
            ),
            "sidebarShortcuts": _read_json(
                self.paths.sidebar_shortcuts_file, DEFAULT_SIDEBAR_SHORTCUTS
            ),
            "shortcutSync": _read_json(self.paths.shortcut_sync_file, DEFAULT_SHORTCUT_SYNC),
            "dashboardCards": _read_dashboard_cards(self.paths.dashboard_cards_file),
            "workspace": _read_json(self.paths.workspace_file, DEFAULT_WORKSPACE),
            "hostsProfiles": _read_json(
                self.paths.hosts_profiles_file, DEFAULT_HOSTS_PROFILES
            ),
        }

    def save_settings(self, payload: dict[str, Any]) -> None:
        allowed = {"settings", "backendConnection", "sidebarShortcuts", "shortcutSync", "dashboardCards", "hostsProfiles"}
        if set(payload) - allowed:
            raise StorageError("设置中包含不支持的字段")

        if "settings" in payload:
            settings = payload["settings"]
            if not isinstance(settings, dict):
                raise StorageError("设置格式无效")
            if set(settings) - {"schemaVersion", "locale", "theme", "sidebarCollapsed", "particleQuality", "motionMode", "sidebarStartup", "restorePinnedTabsOnLaunch", "editorFontSize", "editorLineWrapping", "clipboardMonitoringEnabled", "systemStatusRefreshSeconds", "systemStatusRefreshMigrationVersion", "developerModeEnabled", "activationHotkey"}:
                raise StorageError("设置中包含不支持的字段")
            if settings.get("schemaVersion", SCHEMA_VERSION) != SCHEMA_VERSION:
                raise StorageError("设置版本无效")
            current = _read_settings(self.paths.settings_file)
            update = {key: settings[key] for key in ("locale", "theme", "sidebarCollapsed", "particleQuality", "motionMode", "sidebarStartup", "restorePinnedTabsOnLaunch", "editorFontSize", "editorLineWrapping", "clipboardMonitoringEnabled", "systemStatusRefreshSeconds", "systemStatusRefreshMigrationVersion", "developerModeEnabled", "activationHotkey") if key in settings}
            if "locale" in update and update["locale"] not in APP_LOCALES:
                raise StorageError("语言设置无效")
            if "theme" in update and update["theme"] not in THEMES:
                raise StorageError("主题设置无效")
            if "sidebarCollapsed" in update and not isinstance(
                update["sidebarCollapsed"], bool
            ):
                raise StorageError("侧栏设置无效")
            if "particleQuality" in update and update["particleQuality"] not in PARTICLE_QUALITIES:
                raise StorageError("粒子质量设置无效")
            if "motionMode" in update and update["motionMode"] not in MOTION_MODES:
                raise StorageError("动态效果设置无效")
            if "sidebarStartup" in update and update["sidebarStartup"] not in SIDEBAR_STARTUP_MODES:
                raise StorageError("侧栏启动设置无效")
            if "restorePinnedTabsOnLaunch" in update and not isinstance(
                update["restorePinnedTabsOnLaunch"], bool
            ):
                raise StorageError("固定标签启动设置无效")
            if "editorFontSize" in update and (
                not isinstance(update["editorFontSize"], int) or not 12 <= update["editorFontSize"] <= 16
            ):
                raise StorageError("编辑器字号设置无效")
            if "editorLineWrapping" in update and not isinstance(
                update["editorLineWrapping"], bool
            ):
                raise StorageError("编辑器换行设置无效")
            if "clipboardMonitoringEnabled" in update and not isinstance(
                update["clipboardMonitoringEnabled"], bool
            ):
                raise StorageError("剪切板监控设置无效")
            if "systemStatusRefreshSeconds" in update and update["systemStatusRefreshSeconds"] not in SYSTEM_STATUS_REFRESH_INTERVALS:
                raise StorageError("系统状态刷新设置无效")
            if "systemStatusRefreshMigrationVersion" in update and update["systemStatusRefreshMigrationVersion"] != SYSTEM_STATUS_REFRESH_MIGRATION_VERSION:
                raise StorageError("系统状态刷新设置版本无效")
            if "developerModeEnabled" in update and not isinstance(
                update["developerModeEnabled"], bool
            ):
                raise StorageError("开发者模式设置无效")
            if "activationHotkey" in update:
                try:
                    update["activationHotkey"] = normalize_activation_hotkey(update["activationHotkey"])
                except HotkeyError as exc:
                    raise StorageError(str(exc)) from exc
            current.update(update)
            current["schemaVersion"] = SCHEMA_VERSION
            atomic_write_json(self.paths.settings_file, current)

        if "backendConnection" in payload:
            connection = payload["backendConnection"]
            if not isinstance(connection, dict) or set(connection) - {"schemaVersion", "localApiOrigin", "useLocalApi"}:
                raise StorageError("本机开发服务配置格式无效")
            origin = connection.get("localApiOrigin")
            use_local = connection.get("useLocalApi")
            if connection.get("schemaVersion", SCHEMA_VERSION) != SCHEMA_VERSION or not _is_loopback_api_origin(origin) or not isinstance(use_local, bool):
                raise StorageError("本机开发服务配置无效")
            atomic_write_json(
                self.paths.backend_connection_file,
                {"schemaVersion": SCHEMA_VERSION, "localApiOrigin": origin, "useLocalApi": use_local},
            )

        if "sidebarShortcuts" in payload:
            shortcuts = payload["sidebarShortcuts"]
            if not isinstance(shortcuts, dict) or set(shortcuts) - {"schemaVersion", "toolIds"}:
                raise StorageError("快捷方式格式无效")
            tool_ids = shortcuts.get("toolIds")
            if (
                shortcuts.get("schemaVersion", SCHEMA_VERSION) != SCHEMA_VERSION
                or not isinstance(tool_ids, list)
                or not 1 <= len(tool_ids) <= 12
                or len(set(tool_ids)) != len(tool_ids)
                or any(tool_id not in TOOL_IDS for tool_id in tool_ids)
            ):
                raise StorageError("快捷方式包含无效工具")
            atomic_write_json(
                self.paths.sidebar_shortcuts_file,
                {"schemaVersion": SCHEMA_VERSION, "toolIds": tool_ids},
            )

        if "shortcutSync" in payload:
            # Queue metadata is device-local; access and refresh tokens are intentionally never accepted here.
            sync = payload["shortcutSync"]
            allowed_sync = {"schemaVersion", "accountId", "mode", "revision", "pendingToolIds"}
            if not isinstance(sync, dict) or set(sync) - allowed_sync:
                raise StorageError("快捷方式同步状态格式无效")
            account_id = sync.get("accountId")
            revision = sync.get("revision")
            pending = sync.get("pendingToolIds")
            if (
                sync.get("schemaVersion", SCHEMA_VERSION) != SCHEMA_VERSION
                or account_id is not None and (not isinstance(account_id, str) or not 1 <= len(account_id) <= 80)
                or sync.get("mode") not in {"pending", "enabled", "paused"}
                or revision is not None and (not isinstance(revision, int) or revision < 0)
                or pending is not None and (
                    not isinstance(pending, list)
                    or not 1 <= len(pending) <= 12
                    or len(set(pending)) != len(pending)
                    or any(tool_id not in TOOL_IDS for tool_id in pending)
                )
            ):
                raise StorageError("快捷方式同步状态无效")
            atomic_write_json(
                self.paths.shortcut_sync_file,
                {
                    "schemaVersion": SCHEMA_VERSION,
                    "accountId": account_id,
                    "mode": sync["mode"],
                    "revision": revision,
                    "pendingToolIds": pending,
                },
            )

        if "dashboardCards" in payload:
            cards_payload = payload["dashboardCards"]
            if not isinstance(cards_payload, dict) or set(cards_payload) - {"schemaVersion", "cards", "carouselMode", "classicRotationSpeed", "stepIntervalMs"}:
                raise StorageError("首页卡片格式无效")
            cards = cards_payload.get("cards")
            carousel_mode = cards_payload.get("carouselMode")
            classic_rotation_speed = cards_payload.get("classicRotationSpeed")
            step_interval_ms = cards_payload.get("stepIntervalMs")
            if (
                cards_payload.get("schemaVersion", SCHEMA_VERSION) != SCHEMA_VERSION
                or not isinstance(cards, list)
                or not 1 <= len(cards) <= 6
                or carousel_mode not in {"classic", "step"}
                or not isinstance(classic_rotation_speed, int)
                or not 6 <= classic_rotation_speed <= 30
                or not isinstance(step_interval_ms, int)
                or not 800 <= step_interval_ms <= 6000
                or step_interval_ms % 200 != 0
            ):
                raise StorageError("首页卡片数量或版本无效")
            card_ids: set[str] = set()
            tool_ids: set[str] = set()
            sanitized_cards: list[dict[str, Any]] = []
            for expected_order, card in enumerate(cards):
                if not isinstance(card, dict) or set(card) - {"id", "toolId", "title", "description", "accentColor", "sortOrder", "enabled"}:
                    raise StorageError("首页卡片包含不支持的字段")
                card_id = card.get("id")
                tool_id = card.get("toolId")
                title = card.get("title")
                description = card.get("description")
                accent_color = card.get("accentColor")
                enabled = card.get("enabled")
                if (
                    not isinstance(card_id, str)
                    or not 1 <= len(card_id) <= 80
                    or card_id in card_ids
                    or tool_id not in TOOL_IDS
                    or tool_id in tool_ids
                    or not isinstance(title, str)
                    or not 1 <= len(title.strip()) <= 80
                    or not isinstance(description, str)
                    or len(description) > 240
                    or not isinstance(accent_color, str)
                    or not re.fullmatch(r"#[0-9A-Fa-f]{6}", accent_color)
                    or not isinstance(enabled, bool)
                ):
                    raise StorageError("首页卡片内容无效")
                card_ids.add(card_id)
                tool_ids.add(tool_id)
                sanitized_cards.append(
                    {
                        "id": card_id,
                        "toolId": tool_id,
                        "title": title.strip(),
                        "description": description.strip(),
                        "accentColor": accent_color.lower(),
                        "sortOrder": expected_order,
                        "enabled": enabled,
                    }
                )
            if not any(card["enabled"] for card in sanitized_cards):
                raise StorageError("首页至少需要显示一张卡片")
            atomic_write_json(
                self.paths.dashboard_cards_file,
                {
                    "schemaVersion": SCHEMA_VERSION,
                    "cards": sanitized_cards,
                    "carouselMode": carousel_mode,
                    "classicRotationSpeed": classic_rotation_speed,
                    "stepIntervalMs": step_interval_ms,
                },
            )

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

    def load_notes(self) -> dict[str, Any]:
        index = _read_json(self.paths.notes_index_file, DEFAULT_NOTES)
        notes = index.get("notes")
        if not isinstance(notes, list):
            raise StorageError("笔记索引格式无效")
        loaded = copy.deepcopy(index)
        for sort_order, note in enumerate(loaded["notes"]):
            if not isinstance(note, dict) or not isinstance(note.get("id"), str):
                raise StorageError("笔记索引格式无效")
            if not isinstance(note.get("sortOrder"), int):
                note["sortOrder"] = sort_order
            note_id = note["id"]
            if not NOTE_ID_PATTERN.fullmatch(note_id):
                raise StorageError("笔记标识无效")
            content_file = self.paths.notes_dir / f"{note_id}.md"
            if content_file.exists():
                try:
                    note["content"] = content_file.read_text(encoding="utf-8")
                except (OSError, UnicodeError) as exc:
                    raise StorageError(f"无法读取笔记：{note_id}") from exc
            elif note_id == "about-kaitools":
                note["content"] = DEFAULT_NOTE_CONTENT
            else:
                note["content"] = ""
        return loaded

    def save_notes(self, payload: dict[str, Any]) -> None:
        if set(payload) - {"schemaVersion", "notebooks", "folders", "notes"}:
            raise StorageError("笔记中包含不支持的字段")
        if payload.get("schemaVersion", SCHEMA_VERSION) != SCHEMA_VERSION:
            raise StorageError("笔记版本无效")
        notebooks = payload.get("notebooks")
        folders = payload.get("folders")
        notes = payload.get("notes")
        if not all(isinstance(value, list) for value in (notebooks, folders, notes)):
            raise StorageError("笔记结构格式无效")
        if len(notebooks) > 100 or len(folders) > 1000 or len(notes) > 5000:
            raise StorageError("笔记数量超过限制")
        index_notes: list[dict[str, Any]] = []
        note_ids: set[str] = set()
        for note in notes:
            if not isinstance(note, dict):
                raise StorageError("笔记格式无效")
            allowed_note = {"id", "notebookId", "folderId", "title", "content", "pinned", "revision", "syncStatus", "sortOrder", "createdAt", "updatedAt"}
            if set(note) - allowed_note:
                raise StorageError("笔记中包含不支持的字段")
            note_id = note.get("id")
            title = note.get("title")
            content = note.get("content")
            if not isinstance(note_id, str) or not NOTE_ID_PATTERN.fullmatch(note_id) or note_id in note_ids:
                raise StorageError("笔记标识无效")
            if not isinstance(title, str) or not title.strip() or len(title) > 200 or not isinstance(content, str):
                raise StorageError("笔记内容格式无效")
            if not isinstance(note.get("sortOrder"), int) or note["sortOrder"] < 0:
                raise StorageError("笔记排序无效")
            note_ids.add(note_id)
            atomic_write_text(self.paths.notes_dir / f"{note_id}.md", content)
            index_notes.append({key: value for key, value in note.items() if key != "content"})
        for content_file in self.paths.notes_dir.glob("*.md"):
            if content_file.stem not in note_ids:
                content_file.unlink(missing_ok=True)
        atomic_write_json(
            self.paths.notes_index_file,
            {"schemaVersion": SCHEMA_VERSION, "notebooks": notebooks, "folders": folders, "notes": index_notes},
        )
