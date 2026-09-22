# KAITools 桌面端自动更新发版手册

本文说明 Windows 桌面版的“点击版本号检查更新并应用更新”发布流程。更新只使用静态 HTTPS 文件，不依赖 `kaitools-api`、数据库、Redis 或常驻更新服务。

## 更新模型

桌面端只认可一个已签名的最新版本清单：

```text
latest.json + latest.json.sig
  -> manifests/KAITools-vX.Y.Z.json + .sig
  -> objects/<sha256>
```

客户端逐一比对受管程序文件的 SHA-256，只下载与最新清单不同的文件。它不维护相邻版本补丁链，因此任意包含 `KAIToolsUpdater.exe` 和 `app-manifest.json` 的旧版，都能直接同步到当前最新版本。

`data/`、笔记、设置、日志、文件管理器、WebView2 profile 和其他用户数据永远不在清单中，也不会被读取、下载、删除或覆盖。首个引入此能力的版本需要用户手动安装一次。

## 一次性准备

### 1. 创建发布签名密钥

首次启用时，在受控发布机或 CI 密钥准备环境执行一次：

```powershell
.\.venv\Scripts\python.exe .\scripts\initialize_update_signing_key.py `
  --private-key D:\secrets\kaitools-update-ed25519.pem
```

该命令创建：

- `packaging/update-public-key.pem`：提交到仓库，随桌面包发布；
- 私钥：仅保存在指定安全目录，绝不提交、上传到静态服务器或打入桌面包。

将私钥放入 CI 的受保护密钥库，发布任务通过临时文件或 `KAITOOLS_UPDATE_SIGNING_KEY` 环境变量引用它。密钥丢失后，已经发布的客户端无法信任新密钥签名的更新，必须保留并备份当前私钥。

### 2. 配置静态下载目录

服务器创建仅供发布账号写入、由 Nginx 只读的目录：

```text
/srv/kaitools-downloads/
├─ current -> /srv/kaitools-downloads/releases/desktop-vX.Y.Z-<sha>
├─ releases/
├─ latest.json                 # 可选兼容副本
├─ latest.json.sig             # 可选兼容副本
├─ manifests/
└─ objects/
```

在 SPA 的 `try_files ... /index.html` 回退规则之前配置 Nginx：

```nginx
location = /downloads/kaitools/latest.json {
    alias /srv/kaitools-downloads/current/latest.json;
    default_type application/json;
    add_header Cache-Control "no-store, max-age=0" always;
    add_header X-Content-Type-Options "nosniff" always;
}

location = /downloads/kaitools/latest.json.sig {
    alias /srv/kaitools-downloads/current/latest.json.sig;
    default_type application/octet-stream;
    add_header Cache-Control "no-store, max-age=0" always;
    add_header X-Content-Type-Options "nosniff" always;
}

location ^~ /downloads/kaitools/ {
    alias /srv/kaitools-downloads/;
    autoindex off;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header X-Content-Type-Options "nosniff" always;
}
```

确保 `https://tools.imkai.top/downloads/kaitools/latest.json` 与 [update-policy.json](../packaging/update-policy.json) 一致。Nginx 配置完成后只需校验并 reload 一次；以后每次发版上传静态文件并切换 `current` 软链接，无需重启 Nginx、Java、Redis 或数据库。

## 每次发版

### 1. 维护版本和说明

1. 运行 `scripts/set_version.ps1`，只递增 patch。
2. 填写 `RELEASE_NOTES.md` 当前版本的发布日期、更新内容和升级说明。
3. 对普通稳定版保留 `packaging/update-policy.json` 的 `stable`、`file-sync` 设置；该文件不重复维护目标版本。
4. 执行 `scripts/check_release_notes.ps1` 和 `scripts/verify.ps1`。

### 2. 构建签名发布物

在不包含真实用户数据的隔离构建目录中执行：

```powershell
.\scripts\build_portable.ps1 `
  -SigningKeyPath 'D:\secrets\kaitools-update-ed25519.pem'
```

脚本会验证版本说明，构建 `KAITools.exe` 和独立的 `KAIToolsUpdater.exe`，生成 `app-manifest.json`，然后在 `release/updates/` 写入：

```text
release/updates/
├─ latest.json
├─ latest.json.sig
├─ manifests/KAITools-vX.Y.Z.json
├─ manifests/KAITools-vX.Y.Z.json.sig
└─ objects/<sha256>
```

每个 `objects/<sha256>` 是一个受管程序文件。名称由内容摘要决定，相同内容跨版本只保留一份。传统完整 ZIP 仍会生成，作为首装或紧急手动恢复包，不是正常应用内更新路径。

`build_portable.ps1` 默认会重建 `dist/KAITools`。不得对含有真实 `dist/KAITools/data` 的用户运行目录直接执行；应使用隔离构建工作区，或先按仓库规范备份并恢复数据。

### 3. 上传与生效顺序

GitHub Actions 会在每次推送 `master` 时自动完成构建和发布，发布账号只上传静态文件，严格按以下顺序操作：

1. 上传 `objects/` 中的新摘要对象；已有同名摘要对象无需覆盖。
2. 校验已上传对象的大小和 SHA-256。
3. 上传 `manifests/KAITools-vX.Y.Z.json` 与对应 `.sig`。
4. 从公网 HTTPS 读取版本清单及签名，确认均可访问。
5. 上传 `latest.json` 和 `latest.json.sig` 到临时远程文件名。
6. 将完整发布目录移动到 `releases/`，再在服务器同一文件系统内原子替换 `current` 软链接。
7. 从公网再次读取 `latest.json`，确认版本号、摘要和签名为本次发布内容。

若使用 CDN，只刷新 `latest.json` 与 `latest.json.sig`。版本化清单和哈希对象应长期缓存，不需要刷新。

发布后用一套旧版桌面包验证：点击版本号、发现新版本、下载差异文件、重启、确认版本号，以及比较升级前后的 `data/` 内容与 WebView2 profile。

## 回滚与故障处理

发布错误时，不要删除历史对象或版本清单。使用同一私钥重新签名并原子回退 `latest.json` 和 `latest.json.sig` 到上一稳定版本，客户端下次检查将只看到回退后的版本。

客户端更新过程会先下载到 `data/pending/updates/`，校验对象摘要后才启动独立 Updater。Updater 备份将变化或删除的受管文件；新版本无法完成窗口启动健康检查时，会恢复旧程序并重新启动旧版。上次失败信息记录在受控 pending 目录，并在下次打开版本说明时展示。

不要手工向下载目录上传未签名的 `latest.json`、版本清单，或包含 `data/` 的对象。客户端会拒绝签名、摘要、产品名、版本、路径、大小、HTTPS 来源或清单字段不符合约定的更新。
