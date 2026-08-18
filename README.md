# KAITools

[English](README.en.md) | [Gitee 仓库](https://gitee.com/i-_-kaikai/kaitools) | [GitHub 仓库](https://github.com/i-kaikai/KAItools)

KAITools 是面向开发者的本地工具箱，同时提供纯静态 Web 版和 Windows 10/11 x64
免安装桌面版。桌面版使用 Python、pywebview 与 WebView2 承载 Vue 3 + TypeScript
界面；解压 ZIP 后双击 `KAITools.exe` 即可运行，目标电脑无需安装 Python 或 Node.js。

## 功能模块

### 数据格式

- **JSON**：严格校验、格式化、压缩、彩色可编辑结果、树视图、关系图和 JSONPath 查询；关系图按层级聚合字段，节点内容可直接编辑并回写。
- **JSON 对比**：语义化比较两份 JSON，可忽略对象键顺序并高亮差异。
- **JSON / JavaBean**：JSON 与 JavaBean 双向转换，支持类名和 Lombok 选项。
- **SQL 美化**：支持多种 SQL 方言、关键字大小写和缩进设置。
- **YAML 美化**：YAML 校验、解析与格式化。
- **XML 格式化**：XML 校验、格式化与压缩。

### 编码转换

- **Base64 文本**：UTF-8 文本编码、解码和 URL Safe 模式。
- **Base64 图片**：图片文件与 Data URL 双向转换和预览。
- **Base64 文件**：任意文件与 Base64 双向转换。
- **MD5 摘要**：计算 UTF-8 文本标准 32 位摘要，支持大小写输出。

### 开发辅助

- **Java 转义**：字符串转义、反转义和可选 Unicode 转换。
- **日期转换**：自动识别时间戳、ISO 8601、常见日期、中文日期、RFC 和带时区格式，并输出本地、UTC、ISO 与指定 IANA 时区结果。
- **Crontab 生成器**：表达式与字段双向编辑，支持字段模板、常用预设、中文语义、IANA 时区和未来 5/10/20 次执行时间。
- **正则工作台**：实时匹配高亮、捕获组明细、常用标志和替换预览。

### 文本与系统

- **文本比较**：按行或字符比较文本并高亮差异。
- **文本统计**：统计字符、单词、行数、段落和 UTF-8 字节数。
- **Hosts**：桌面版直接编辑系统 Hosts 文件，支持差异预览、源文件摘要校验、UAC 保存和完整文件备份恢复；Web 版明确显示桌面限定状态。

所有左右双栏工具的输入和生成结果都可继续编辑，分割线支持鼠标拖动、键盘调整和
双击复位。常用工具的结果可直接发送到其他工具继续处理；工作标签支持固定、多开、
右键关闭当前/其他/右侧/全部标签。

## 运行与数据

- 桌面版设置和固定标签保存在 EXE 同级 `data` 目录；未固定标签只保留在内存中。
- Web 版状态保存在当前浏览器的 `localStorage`，工具输入不会上传到服务器。
- Hosts 只能通过桌面版访问固定系统路径；保存前会检查文件摘要、校验语法、请求 UAC，并在原子替换前备份原文件。
- 桌面桥接只暴露白名单能力，不提供任意文件写入、命令执行或任意 URL 打开接口。

## 本地开发

需要 Python 3.13 x64、Node.js 24 LTS、pnpm 和 Microsoft Edge WebView2 Runtime。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Set-Location frontend
pnpm install --frozen-lockfile
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
.\scripts\smoke_portable.ps1
```

便携目录输出到 `dist/KAITools`，ZIP 和 SHA-256 文件输出到 `release`。

## Web 构建

Web 版是无需业务后端的纯静态站点：

```powershell
Set-Location frontend
pnpm install --frozen-lockfile
pnpm build:web
```

静态文件输出到 `build/web`。
