# -*- mode: python ; coding: utf-8 -*-
import re
from pathlib import Path

ROOT = Path(SPECPATH)
WEB_ROOT = ROOT / "build" / "web"
APP_ICON = ROOT / "frontend" / "public" / "brand" / "kaitools-app-icon.ico"
VERSION_FILE = ROOT / "VERSION"
WINDOWS_VERSION_RESOURCE = ROOT / "build" / "kaitools-version-info.txt"

APP_VERSION = VERSION_FILE.read_text(encoding="utf-8").strip()
if not re.fullmatch(r"\d+\.\d+\.\d+", APP_VERSION):
    raise SystemExit(f"VERSION must use semantic versioning (x.y.z): {APP_VERSION!r}")

version_parts = tuple(int(part) for part in APP_VERSION.split(".")) + (0,)
WINDOWS_VERSION_RESOURCE.parent.mkdir(parents=True, exist_ok=True)
WINDOWS_VERSION_RESOURCE.write_text(
    f"""VSVersionInfo(
  ffi=FixedFileInfo(
    filevers={version_parts},
    prodvers={version_parts},
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo(
      [
      StringTable(
        u'040904B0',
        [StringStruct(u'CompanyName', u'KAITools'),
         StringStruct(u'FileDescription', u'KAITools Windows Desktop Toolbox'),
         StringStruct(u'FileVersion', u'{APP_VERSION}'),
         StringStruct(u'InternalName', u'KAITools'),
         StringStruct(u'OriginalFilename', u'KAITools.exe'),
         StringStruct(u'ProductName', u'KAITools'),
         StringStruct(u'ProductVersion', u'{APP_VERSION}')])
      ]),
    VarFileInfo([VarStruct(u'Translation', [1033, 1200])])
  ]
)
""",
    encoding="utf-8",
)

if not (WEB_ROOT / "index.html").is_file():
    raise SystemExit("Frontend build is missing. Run pnpm build first.")
if not APP_ICON.is_file():
    raise SystemExit(f"Application icon is missing: {APP_ICON}")

a = Analysis(
    [str(ROOT / "desktop" / "main.py")],
    pathex=[str(ROOT / "desktop")],
    binaries=[],
    datas=[(str(WEB_ROOT), "web"), (str(VERSION_FILE), ".")],
    hiddenimports=["webview.platforms.edgechromium", "pythoncom", "pywintypes", "win32com", "win32com.client"],
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
    version=str(WINDOWS_VERSION_RESOURCE),
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
