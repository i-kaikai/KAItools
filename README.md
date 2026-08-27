# KAITools

[English](README.en.md) | [Gitee 仓库](https://gitee.com/i-_-kaikai/kaitools) | [GitHub 仓库](https://github.com/i-kaikai/KAItools)

项目预览：[https://tools.imkai.top/](https://tools.imkai.top/)

KAI · Keep Approaching Ideal · 始终靠近理想

KAITools 是面向开发者的本地工具箱，同时提供纯静态 Web 版和 Windows 10/11 x64
免安装桌面版。桌面版使用 Python、pywebview 与 WebView2 承载 Vue 3 + TypeScript
界面；解压 ZIP 后双击 `KAITools.exe` 即可运行，目标电脑无需安装 Python 或 Node.js。
本仓库是客户端仓库，包含 Vue 前端与 Windows 桌面宿主；Spring Boot API 已拆分为独立后端仓库。

未来的账户、同步、前后端边界与交付路线见
[未来版本需求规格说明书](docs/KAITools-未来版本需求规格说明书.md)；当前的产品界面、离线边界与前端迭代见
[前端需求规格说明书](docs/KAITools-前端需求规格说明书.md)。

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
- **超级计算器**：科学函数、进制/位运算、单位换算、金融/日期以及矩阵、复数和统计计算。
- **笔记**：笔记本、文件夹与 Markdown 笔记；桌面版使用受控 `data/notes/` 目录，Web 版使用 IndexedDB，首页展示置顶笔记。

### 文本与系统

- **文本比较**：按行或字符比较文本并高亮差异。
- **文本统计**：统计字符、单词、行数、段落和 UTF-8 字节数。
- **Hosts**：桌面版直接编辑系统 Hosts 文件，支持差异预览、源文件摘要校验、UAC 保存和完整文件备份恢复；Web 版明确显示桌面限定状态。
- **剪切板历史**：仅桌面版记录最近 100 条纯文本剪切板内容；仅内存保存，退出应用自动清空，浏览器版提供桌面下载入口。

所有左右双栏工具的输入和生成结果都可继续编辑，分割线支持鼠标拖动、键盘调整和
双击复位。常用工具的结果可直接发送到其他工具继续处理；工作标签支持固定、多开、
右键关闭当前/其他/右侧/全部标签。

## 运行与数据

- 桌面版设置、固定标签和受控笔记保存在 EXE 同级 `data` 目录；未固定标签只保留在内存中。
- Web 版工作台状态保存在当前浏览器的 `localStorage`，Markdown 正文存入 IndexedDB；工具输入不会上传到服务器。
- 应用设置支持主题、粒子质量（高质量/均衡/关闭）、减少动态效果、侧栏与固定标签启动恢复、编辑器字号和自动换行；均仅保存在当前设备。关闭粒子会释放首页 Three.js WebGL 渲染资源。
- 桌面版按 `Esc` 或全局唤起快捷键可隐藏到系统托盘；前台再次按全局快捷键会隐藏，托盘菜单可恢复或退出，标题栏 `X` 直接退出。
- 首页系统状态会按运行环境提供不同诊断：桌面版显示 CPU、内存、电量、工作区数据状态以及 Windows、WebView2、数据目录、托盘与剪切板状态；浏览器版仅显示浏览器、网络、存储、视口和 WebGL 状态。
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
.\scripts\set_version.ps1 x.y.z
.\scripts\check_version.ps1
.\scripts\verify.ps1
.\scripts\build_portable.ps1
.\scripts\smoke_portable.ps1
```

根目录 `VERSION` 是唯一维护的版本号。每个交付批次都先按语义化版本更新它；前端、Python
项目和 Windows 文件元数据会在构建时从它派生，校验脚本会阻止遗留的版本副本进入构建。

便携目录输出到 `dist/KAITools`，ZIP 和 SHA-256 文件输出到 `release`。

## Web 构建

Web 版是无需业务后端的纯静态站点：

```powershell
Set-Location frontend
pnpm install --frozen-lockfile
pnpm build:web
```

静态文件输出到 `build/web`。

## 本地后端联调

后端是可选的独立 Java 21 服务，桌面应用不会自动启动它。普通应用固定连接 `https://tools.imkai.top/api` 用于账户与同步；服务不可用或用户未登录时，工具、笔记、Hosts 和工作台继续只在本机运行。后端源码位于工作区内的独立仓库 `E:\prodect\codingTool\kaitools-api`；本机服务地址仅可在隐藏的开发者模式中作为临时覆盖项配置，默认 `http://127.0.0.1:8080`。前端会固定追加 `/api/...`，地址中不要填写 `/api`。

API 的受控 `application.yml` 保留 PostgreSQL JDBC URL、主机端口与非敏感运行参数；数据库、SMTP、Redis 凭据和访问令牌签名密钥通过环境变量或受 Git 忽略的相邻 `application.local.yml` 提供。完整变量说明见 API 仓库 README。

```powershell
Set-Location E:\prodect\codingTool\kaitools-api
mvn spring-boot:run
```

服务在 `GET http://127.0.0.1:8080/api/health` 就绪。数据库配置缺失或无效时，服务会拒绝启动；前端本地工具和笔记不受影响。
