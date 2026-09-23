# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

ROOT = Path(SPECPATH)
APP_ICON = ROOT / "frontend" / "public" / "brand" / "kaitools-app-icon.ico"
VERSION_FILE = ROOT / "VERSION"

if not APP_ICON.is_file():
    raise SystemExit(f"Application icon is missing: {APP_ICON}")

a = Analysis(
    [str(ROOT / "desktop" / "updater_main.py")],
    pathex=[str(ROOT / "desktop")],
    binaries=[],
    datas=[(str(VERSION_FILE), ".")],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    name="KAIToolsUpdater",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    target_arch="x86_64",
    icon=str(APP_ICON),
)
