# DevToolkit

DevToolkit 是仅支持 Windows 10/11 x64 的本地开发工具箱，使用 Python、
pywebview、WebView2、Vue 3 和 TypeScript 构建。发布包无需安装 Python 或 Node，
解压 ZIP 后双击 `DevToolkit.exe` 即可运行。

## 功能

- JSON：严格校验、格式化、压缩、可编辑彩色结果和树视图
- Java 转义：字符串转义、反转义和 Unicode 转换
- 日期转换：自动识别时间戳、ISO、常见日期、中文日期、RFC 和时区格式
- Hosts：完整本地文件编辑、差异预览、UAC 保存和整文件备份恢复
- MD5 摘要：UTF-8 文本的标准 32 位摘要

设置和固定标签保存在 EXE 同级 `data` 目录，未固定标签只保留在内存中。Hosts
只允许操作固定系统路径；保存时会检查源文件摘要、校验整份语法、请求 UAC，并在
原子替换前备份完整文件。自动化测试和预览不会修改真实系统 Hosts。

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
