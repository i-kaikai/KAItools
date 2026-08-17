# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

ROOT = Path(SPECPATH)
WEB_ROOT = ROOT / "build" / "web"
APP_ICON = ROOT / "frontend" / "public" / "brand" / "kaitools-app-icon.ico"

if not (WEB_ROOT / "index.html").is_file():
    raise SystemExit("Frontend build is missing. Run pnpm build first.")
if not APP_ICON.is_file():
    raise SystemExit(f"Application icon is missing: {APP_ICON}")

a = Analysis(
    [str(ROOT / "desktop" / "main.py")],
    pathex=[str(ROOT / "desktop")],
    binaries=[],
    datas=[(str(WEB_ROOT), "web")],
    hiddenimports=["webview.platforms.edgechromium"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "cefpython3",
        "PyQt5",
        "PyQt6",
        "PySide2",
        "PySide6",
        "tkinter",
    ],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="KAITools",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch="x86_64",
    codesign_identity=None,
    entitlements_file=None,
    version=str(ROOT / "packaging" / "version_info.txt"),
    icon=str(APP_ICON),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="KAITools",
)
