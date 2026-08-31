# KAITools

[中文](README.md) | [Gitee repository](https://gitee.com/i-_-kaikai/kaitools) | [GitHub repository](https://github.com/i-kaikai/KAItools)

KAITools is a local developer toolbox available as a static browser build and a
portable Windows 10/11 x64 desktop application. The desktop application combines
Python, pywebview, WebView2, Vue 3, and TypeScript. Extract the ZIP and launch
`KAITools.exe`; Python and Node.js are not required on the target computer.

## Tools

### Data formats

- **JSON**: strict validation, formatting, minification, editable syntax-colored output, tree view, relationship graph, and JSONPath queries. Graph cards group fields by level, and node content can be edited and applied back to the result.
- **JSON Diff**: semantic comparison with optional object-key order normalization and highlighted changes.
- **JSON / JavaBean**: two-way conversion with class name and Lombok options.
- **SQL Formatter**: multiple SQL dialects, keyword casing, and indentation controls.
- **YAML Formatter**: validation, parsing, and formatting.
- **XML Formatter**: validation, formatting, and minification.

### Encoding

- **Base64 Text**: UTF-8 encoding, decoding, and URL-safe mode.
- **Base64 Image**: image file and Data URL conversion with preview.
- **Base64 File**: arbitrary file and Base64 conversion.
- **MD5 Digest**: standard 32-character UTF-8 text digests with lower- or uppercase output.
- **HTML to PDF**: import HTML or a ZIP with local CSS, fonts, and images, then safely preview and export without remote asset requests.
- **Word to PDF**: Windows desktop prefers installed Microsoft Word and falls back to LibreOffice; Web uses compatibility rendering.
- **PDF to Word**: Windows uses enhanced Microsoft Word conversion when available; Web and no-Word environments create an editable text-compatible DOCX.

### Developer utilities

- **Java Escape**: string escaping, unescaping, and optional Unicode conversion.
- **Date Converter**: automatic recognition of timestamps, ISO 8601, common date formats, Chinese dates, RFC values, and time zones, with local, UTC, ISO, and selected IANA-zone output.
- **Crontab Generator**: two-way expression and field editing, field templates, presets, readable summaries, IANA time zones, and the next 5/10/20 runs.
- **Regex Workbench**: live match highlighting, capture details, common flags, and replacement previews.
- **Super Calculator**: scientific functions, base and bit operations, unit conversion, finance/date, plus matrix, complex, and statistics calculations.
- **Notes**: notebooks, folders, and Markdown notes stored in desktop `data/notes/` or browser IndexedDB, with the pinned note surfaced on the home workspace.

### Text and system

- **Text Diff**: line- or character-level comparison with highlighted changes.
- **Text Statistics**: character, word, line, paragraph, and UTF-8 byte counts.
- **Hosts**: direct system Hosts editing in the desktop build with diff preview, source digest checks, UAC save, and full-file backup and restore. The web build clearly marks this feature as desktop-only.
- **Clipboard History**: desktop-only in-memory history for the latest 100 text clipboard entries. It clears on exit; the browser build provides a desktop download entry.

Both panes remain editable in every side-by-side tool. The divider supports
pointer dragging, keyboard adjustment, and double-click reset. Results from
common tools can be sent directly into another tool for continued processing.
Workspace tabs support pinning, multiple instances, and context-menu close operations.

## Runtime and data

- Desktop settings and pinned tabs are stored in the `data` directory beside the EXE; unpinned tabs remain in memory only.
- The web build stores state in the current browser's `localStorage`. Tool input is not uploaded to a server.
- Application settings are device-local and cover theme, particle quality (high, balanced, or off), reduced motion, workspace startup, editor font size, and line wrapping. Turning particles off releases the Three.js WebGL resources.
- Pressing `Esc` or the global activation shortcut can hide the desktop app to the tray; the active window toggles to hidden with the same shortcut, tray actions restore or exit, and the title-bar close button exits directly.
- The home system status adapts to the runtime: desktop reports CPU, memory, power, workspace-data, Windows/WebView2/data/tray/clipboard state, while the web build reports browser/network/storage/viewport/WebGL capability.
- Hosts access is restricted to the fixed system path. Saves validate the source digest and syntax, request UAC, and back up the original file before atomic replacement.
- The desktop bridge exposes a fixed allowlist and provides no arbitrary file writes, command execution, or arbitrary URL opening.

## Local development

Install Python 3.13 x64, Node.js 24 LTS, pnpm, and Microsoft Edge WebView2 Runtime.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Set-Location frontend
pnpm install --frozen-lockfile
pnpm dev
```

Start the desktop window in a second terminal:

```powershell
$env:DEVTOOLKIT_DEV_URL = 'http://127.0.0.1:5173'
.\.venv\Scripts\python.exe desktop\main.py
```

## Verification and packaging

```powershell
.\scripts\set_version.ps1 x.y.z
.\scripts\check_release_notes.ps1
.\scripts\check_version.ps1
.\scripts\verify.ps1
.\scripts\build_portable.ps1
.\scripts\smoke_portable.ps1
```

The root `VERSION` file is the only maintained version. Bump it for every delivery using semantic
versioning; frontend, Python, and Windows file metadata derive from it during builds, and the check
script blocks maintained version copies from entering a build.

Setting a new version prepends a draft entry to `RELEASE_NOTES.md`. Before publishing, the releaser
fills in the release date and changes. Portable packaging rejects a current-version entry that still
contains `TBD` and includes the completed release notes in the package.

The portable directory is written to `dist/KAITools`; the ZIP and SHA-256 files
are written to `release`.

## Web build

The web build is a static site and has no application backend:

```powershell
Set-Location frontend
pnpm install --frozen-lockfile
pnpm build:web
```

Static assets are written to `build/web`.
