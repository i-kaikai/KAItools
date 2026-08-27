# KAITools 客户端仓库协作规范

本文件适用于 `E:\prodect\codingTool\kaitools-web`。本仓库独立维护 Vue 前端、Python
桌面宿主、品牌资源和 Windows 发布流程。后端源码属于相邻的 `kaitools-api` 仓库。

## 1. 仓库与兼容性边界

- 开始工作前执行 `git status --short --branch`。仓库可能有大量未提交修改；不得回退、
  覆盖、格式化或清理与当前任务无关的用户改动。
- 所有面向用户的名称统一使用 `KAITools`；标语为
  `KAI · Keep Approaching Ideal · 始终靠近理想`。
- 不要仅为品牌整洁而修改内部兼容标识。Python 包名 `devtoolkit`、已有浏览器存储键、
  单实例 mutex/pipe 名称和激活协议必须保留，除非任务明确包含数据或协议迁移。
- 正式品牌资产以 `branding/kaitools-mark.svg` 为母版，应用图标以
  `frontend/public/brand/kaitools-app-icon.ico` 为准。修改标志时保持已确认的轮廓。
- 发布名称保持 `KAITools.spec`、`KAITools.exe`、`dist/KAITools` 和
  `KAITools-v<version>-windows-x64.zip`。
- 根目录 `VERSION` 是产品版本的权威来源。每个准备交付的功能、修复、界面或发布配置
  修改都必须同步更新版本号；默认修复递增 patch，兼容功能递增 minor，破坏性变更递增
  major。只维护此文件；前端、Python 项目和 Windows 打包元数据必须在构建时从它派生，
  不得保存同步副本。使用 `scripts/set_version.ps1` 更新版本，并由
  `scripts/check_version.ps1` 校验。
- 不要把 Spring Boot、PostgreSQL、Redis 或其他 API 服务实现放进本仓库。客户端只通过
  明确的 `/api/...` 契约连接独立服务。

## 2. Web、桌面与数据边界

本仓库必须同时维护两种客户端运行模式，不能为其中一种破坏另一种：

| 模式 | 核心边界 |
| --- | --- |
| Web | 可独立部署的静态 Vue 应用；无后端或未登录时仍可使用本地工具。状态使用 `localStorage`，笔记正文使用 IndexedDB。 |
| Windows 桌面 | Python 3.13 + pywebview 6.2.1 + WebView2 承载相同前端；设置、笔记和运行数据位于受控 `data/`，系统能力通过白名单桌面桥接访问。 |

- 保持离线优先。服务不可用、未登录或远端地址不可达时，JSON、编辑器、计算器、笔记、
  Hosts 等本地能力不能被阻塞，也不应向普通用户显示误导性的开发服务错误。
- 工具输入、Hosts 内容、剪切板历史、日志、设备路径、文件内容和本地配置不得上传。
  当前远端同步范围以现有接口为准；不要把笔记或首页卡片擅自加入同步。
- API origin 只能是源地址，不含 `/api`、业务路径、参数、凭据或令牌；统一 API 客户端
  负责拼接 `/api/...`。不要恢复 `/api/v1` 调用。
- 访问令牌只保存在内存中。会话恢复使用 HttpOnly 刷新 Cookie，并以
  `credentials: include` 调用 `/api/auth/token/refresh`。
- 桌面 WebView2 必须使用 `private_mode=False` 和明确的持久化 profile 目录，不能退回
  临时 profile，否则关闭应用后登录 Cookie 会丢失。
- Web 端不得伪造桌面能力。Hosts、托盘、全局快捷键、剪切板监听等应显示明确的
  “仅 Windows 桌面版可用”状态；浏览器可完成的通用工具继续可用。
- 桌面桥接只暴露固定、无歧义的白名单方法，统一返回 `{ ok, data?, error? }`。不得增加
  任意文件路径、任意命令/脚本执行或任意 URL 打开接口。
- Hosts 只允许操作系统固定 Hosts 路径；保留语法校验、源摘要并发检查、备份、UAC 和
  原子替换流程。
- 剪切板历史仅记录纯文本、仅存内存、退出即清空；保持现有容量和单条大小限制，不得
  写盘或同步。

## 3. 前端与桌面开发

- 前端入口位于 `frontend/`，使用 Vue 3、TypeScript、Vite、Pinia、CodeMirror、Lucide
  和 Three.js。优先复用现有组件、状态仓库、设计令牌和工具注册表。
- 新工具通过 `frontend/src/tools/registry.ts` 注册，保持工作台骨架不依赖具体工具。
  运行环境能力通过注册信息或统一 API 判断，不要在页面中散落桌面判断。
- 所有左右双栏工具的输入和输出都应可编辑，分栏可拖动、键盘调整和复位。修改共享
  `CodeEditor`、`ResizableSplit` 或查找能力时，要回归多个消费工具。
- 首页系统默认可提供 6 张卡片，但 6 不是上限。最大数量是当前已注册工具数，同一工具
  只能添加一次；旧的 `carouselMode` 值 `classic` 和 `step` 必须兼容。
- 首页卡片管理入口必须在首页流程中可发现；侧栏快捷方式管理也必须有可见入口，不要把
  关键定制能力藏在设置深处。
- 桌面设置、浏览器状态和 Pinia 状态都要做版本化迁移和严格白名单校验。持久化或纯函数
  转换 Pinia 响应式数据前先复制为普通对象，不要对 reactive proxy 直接使用
  `structuredClone`。
- 桌面窗口、托盘、全局快捷键、单实例、剪切板和系统状态属于 Python 宿主职责；Vue
  只通过 `desktopApi` 调用，不直接耦合 Win32 实现。
- 面向用户的界面、错误提示、可访问文本和主要文档优先使用中文。

## 4. 界面与交互

- 设计目标是安静、清晰、信息密度适中的开发者工作台。可以借鉴 Phenomenon Studio
  的层级、空间感和动效质量，但可读性优先；不要用极小字号、低对比文字、细密电路
  网格或纯装饰效果制造“科技感”。
- 同时检查深色、浅色和跟随系统主题。文字、清空/危险按钮、禁用态、焦点环在三种主题
  下都必须可辨认。
- 布局必须覆盖紧凑桌面窗口、常规桌面、4K/超宽屏和 Web 移动视口。侧栏展开、弹窗、
  卡片管理、笔记树、编辑器和页面滚动条不得互相遮挡；固定格式区域要有稳定尺寸约束。
- 动效必须服务于反馈或空间关系。高频编辑、搜索和键盘操作保持即时，不加装饰动画；
  支持 `prefers-reduced-motion` 和应用内减少动态效果设置。
- 粒子、3D 轮播等持续渲染在页面隐藏、应用后台或最小化时暂停，并及时释放不用的
  WebGL、几何体、材质和动画帧。修改后至少检查一段稳定运行期，不能只看启动瞬时内存。
- 当用户明确要求“先看方案再改代码”时，先提供信息架构真正不同的可运行 Demo，并在
  用户确认后再改产品代码；不要只换文案或配色冒充不同方案。

## 5. 验证策略

测试范围按风险扩展，避免局部样式调整默认运行全部套件，也不要只靠编译宣称完成：

- 小范围前端改动：至少执行类型检查和相关 Vitest；涉及布局时补对应 Playwright 截图或
  E2E，并检查任务涉及的主题和视口。
- 共享编辑器、状态迁移、运行模式或持久化改动：执行相关单测，并同时覆盖桌面模拟和 Web
  模式。Cookie/profile 改动必须验证关闭重开后的会话恢复。
- Python 桥接或 Win32 生命周期改动：执行相关 pytest，并验证真实桌面能力或受控替身；
  编译通过不代表托盘、剪切板、快捷键或 WebView2 行为正确。
- 发布或跨运行时改动：运行完整验证、打包与 EXE 冒烟。最后一次源代码或测试修改之后
  必须重跑受影响测试，不能沿用修改前的通过结果。
- 收尾执行 `git diff --check`，报告实际执行的命令、通过结果、跳过项和未验证风险；不要
  复用历史测试数量、PID、端口状态或 SHA-256 作为当前证据。

常用命令：

```powershell
Set-Location frontend
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:e2e:web

Set-Location ..
.\.venv\Scripts\python.exe -m pytest
.\scripts\verify.ps1
```

使用仓库声明的 Python 3.13、Node 24 和 pnpm 版本；具体版本与命令以
`pyproject.toml`、`frontend/package.json` 和 `scripts/` 为准。

## 6. 构建、数据与进程安全

- `scripts/build_portable.ps1` 当前会删除并重建 `dist/KAITools`。运行前必须检查
  `dist/KAITools/data`；该目录可能包含用户设置、笔记、Cookie profile 和日志。未经
  明确确认不得删除或覆盖。
- 优先在独立暂存目录构建和验证，再只同步 `KAITools.exe` 与 `_internal` 等运行时文件，
  保留目标 `data`。若必须使用正式构建脚本，先做可验证备份，构建后恢复并核对数据。
- generated `dist`、ZIP 和校验值只有在当前精确源码树完成构建与冒烟后才可报告为最新。
- 启动本地开发服务后向用户提供地址。用户要求关闭时，只定位并停止该地址/端口对应的
  PID，然后复查端口；不要批量结束所有 Node、Python 或 WebView2 进程。

## 7. Git、远程与完成标准

- 不要擅自拉取、变基、提交、推送、部署、修改 DNS 或操作远端服务器。任务明确要求时，
  先核对本仓库的分支、远端和变更范围。
- 本仓库以 Gitee 为主要 Git 远端，界面同时包含 Gitee 与 GitHub 固定项目入口；更改链接
  时同步检查桌面白名单、Web 新标签安全属性、README 和测试。
- `tools.imkai.top`、ICP、DNS、SSH、服务器 OS、Node/pnpm、Nginx 和远端目录都是时效性
  状态。部署前必须重新探测，不能依据旧聊天假定当前状态。
- 公开部署必须保留 Web/桌面双运行时，不得为了服务器发布删除 pywebview、DesktopApi、
  PyInstaller 或本地数据兼容逻辑。
- 交付说明列出修改位置、用户可见结果、实际验证和剩余风险。不要把计划、临时 Demo、
  独立测试包或历史构建误报为正式产品。
