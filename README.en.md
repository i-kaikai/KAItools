# KAITools

[中文](README.md) | [Gitee repository](https://gitee.com/i-_-kaikai/kaitools) | [GitHub repository](https://github.com/imxukai/KAItools)

KAITools is a local developer toolbox available as a static browser build and a
portable Windows 10/11 x64 desktop application. The desktop application combines
Python, pywebview, WebView2, Vue 3, and TypeScript. Extract the ZIP and launch
`KAITools.exe`; Python and Node.js are not required on the target computer.

## Tools

### Data formats

- **JSON**: strict validation, formatting, minification, editable syntax-colored output, tree view, and a relationship graph. Graph cards group fields by level, and node content can be edited and applied back to the result.
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

### Developer utilities

- **Java Escape**: string escaping, unescaping, and optional Unicode conversion.
- **Date Converter**: automatic recognition of timestamps, ISO 8601, common date formats, Chinese dates, RFC values, and time zones, with local, UTC, ISO, and selected IANA-zone output.
- **Crontab Generator**: two-way expression and field editing, field templates, presets, readable summaries, IANA time zones, and the next 5/10/20 runs.

### Text and system

- **Text Diff**: line- or character-level comparison with highlighted changes.
- **Text Statistics**: character, word, line, paragraph, and UTF-8 byte counts.
- **Hosts**: direct system Hosts editing in the desktop build with diff preview, source digest checks, UAC save, and full-file backup and restore. The web build clearly marks this feature as desktop-only.

Both panes remain editable in every side-by-side tool. The divider supports
pointer dragging, keyboard adjustment, and double-click reset. Workspace tabs
support pinning, multiple instances, and context-menu close operations.

## Runtime and data

- Desktop settings and pinned tabs are stored in the `data` directory beside the EXE; unpinned tabs remain in memory only.
- The web build stores state in the current browser's `localStorage`. Tool input is not uploaded to a server.
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
.\scripts\verify.ps1
.\scripts\build_portable.ps1
.\scripts\smoke_portable.ps1
```

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
