# DevToolkit

DevToolkit is a developer toolbox with a browser build and a Windows 10/11 x64
desktop build. The desktop application uses Python, pywebview, WebView2, Vue 3,
and TypeScript. Extract the portable ZIP and launch `DevToolkit.exe`; Python and
Node.js are not required on the target desktop.

## Features

- JSON validation, formatting, minification, editable output, and tree view
- Java string escaping, unescaping, and Unicode conversion
- Date and timestamp conversion across common formats and time zones
- Desktop Hosts editing with conflict detection, UAC elevation, backup, and restore
- MD5 digests for UTF-8 text

Desktop settings and pinned tabs are stored in the `data` directory beside the
EXE. The web build stores them in the current browser's `localStorage`. Hosts
file access is available only in the Windows desktop build.

## Local development

Install Python 3.13 x64, Node.js 24 LTS, pnpm, and Microsoft Edge WebView2
Runtime, then follow the commands in [README.md](README.md).

## Web build

The web build is a static site and has no application backend:

```powershell
Set-Location frontend
pnpm install --frozen-lockfile
$env:VITE_ICP_NUMBER = 'your approved ICP filing number'
pnpm build:web
```

Static assets are written to `build/web`. The ICP filing link is omitted when
`VITE_ICP_NUMBER` is unset. Tool input stays in the visitor's browser and is not
uploaded to or stored by the server.
