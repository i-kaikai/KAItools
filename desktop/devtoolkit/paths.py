from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AppPaths:
    application_root: Path
    resource_root: Path
    data_root: Path

    @property
    def web_root(self) -> Path:
        return self.resource_root / "web"

    @property
    def settings_file(self) -> Path:
        return self.data_root / "settings.json"

    @property
    def workspace_file(self) -> Path:
        return self.data_root / "workspace.json"

    @property
    def hosts_profiles_file(self) -> Path:
        return self.data_root / "hosts-profiles.json"

    @property
    def backups_dir(self) -> Path:
        return self.data_root / "hosts-backups"

    @property
    def pending_dir(self) -> Path:
        return self.data_root / "pending"

    @property
    def logs_dir(self) -> Path:
        return self.data_root / "logs"


def resolve_paths() -> AppPaths:
    if getattr(sys, "frozen", False):
        application_root = Path(sys.executable).resolve().parent
        resource_root = Path(getattr(sys, "_MEIPASS")).resolve()
    else:
        application_root = Path(__file__).resolve().parents[2]
        resource_root = application_root / "build"

    return AppPaths(
        application_root=application_root,
        resource_root=resource_root,
        data_root=application_root / "data",
    )

