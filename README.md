# DevToolkit

DevToolkit 是使用 Vue 3 和 TypeScript 构建的开发工具箱，同时提供浏览器 Web 版和
Windows 10/11 x64 桌面版。桌面版使用 Python、pywebview 和 WebView2，发布包无需
安装 Python 或 Node，解压 ZIP 后双击 `DevToolkit.exe` 即可运行。

## 功能

- JSON：严格校验、格式化、压缩、可编辑彩色结果和树视图
- Java 转义：字符串转义、反转义和 Unicode 转换
- 日期转换：自动识别时间戳、ISO、常见日期、中文日期、RFC 和时区格式
- Hosts：桌面版支持完整本地文件编辑、差异预览、UAC 保存和整文件备份恢复；Web 版显示桌面限定状态
- MD5 摘要：UTF-8 文本的标准 32 位摘要

桌面版设置和固定标签保存在 EXE 同级 `data` 目录，Web 版保存在当前浏览器的
`localStorage`，未固定标签只保留在内存中。Hosts 只允许桌面版操作固定系统路径；
保存时会检查源文件摘要、校验整份语法、请求 UAC，并在原子替换前备份完整文件。
自动化测试和预览不会修改真实系统 Hosts。

## 本地开发

需要 Python 3.13 x64、Node.js 24 LTS、pnpm 和 Microsoft Edge WebView2 Runtime。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Set-Location frontend
pnpm install
pnpm dev
```

在第二个终端启动桌面窗口：

```powershell
$env:DEVTOOLKIT_DEV_URL = 'http://127.0.0.1:5173'
.\.venv\Scripts\python.exe desktop\main.py
```

## 验证与打包

```powershell
.\scripts\verify.ps1
.\scripts\build_portable.ps1
```

便携 ZIP 和 SHA-256 文件输出到 `release` 目录。

## Web 构建

Web 版是纯静态站点，不需要后端服务。首次安装依赖后执行：

```powershell
Set-Location frontend
pnpm install --frozen-lockfile
$env:VITE_ICP_NUMBER = '备案通过后获得的准确备案号'
pnpm build:web
```

静态文件输出到 `build/web`。未设置 `VITE_ICP_NUMBER` 时不会显示备案号；部署到中国
大陆服务器并正式开放前，应设置准确备案号。Web 构建不会读取、上传或在服务器保存
工具输入内容。

目标站点为 `https://tools.imkai.top/`。在 `imkai.top` 完成腾讯云 ICP 备案前，保持
`tools.imkai.top` 无 A/AAAA 解析且不启用公网 Nginx 站点。
