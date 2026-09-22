# GitHub Actions Web Pipeline

本仓库的 GitHub Actions 负责 Web 发布和 Windows 桌面更新发布。桌面 Job 使用独立的
Windows Runner，不在 Linux Web 发布任务中生成或覆盖用户数据。

## 工作流

- `Web CI` 在推送和 Pull Request 时运行 Node 24、Python 3.13、前端类型检查、单元测试、
  两套 Playwright 测试、浏览器构建和 Python 测试。成功后保留 7 天 `build/web` 制品。
- `Release Web` 在 `master` 分支收到推送后自动执行。流水线重新验证并构建当前提交，再将
  同一制品交给部署任务。每个发布目录使用 `web-v版本号-提交SHA` 命名，避免同一版本重复
  推送互相覆盖。
- `Release Web / desktop` 与 Web 发布并行运行，同样由每次 `master` 推送触发。Windows `desktop`
  Job 只构建、签名、校验并上传更新压缩包；Ubuntu `desktop-deploy` Job 下载该 artifact，
  再使用 Linux SSH/SCP 环境发布并切换桌面更新目录的 `current` 软链接。发布失败不会影响
  Web Job 的独立回滚。

生产发布任务使用 GitHub `production` Environment 读取 Secrets。若要求推送 `master` 后
立即部署，不要在该 Environment 配置 required reviewers；可以将允许部署的分支限制为
`master`。如保留 required reviewers，每次推送都会在部署阶段等待审批。

## 运行原理

一次代码推送的链路如下：

```text
Gitee master
  -> Gitee Push 镜像
  -> GitHub master
  -> Release Web / build
  -> GitHub Actions artifact
  -> Release Web / deploy
  -> SSH 上传到 Linux
  -> current 软链接切换
  -> WEB_HEALTH_URL 检查

桌面更新使用独立链路：

```text
Gitee master
  -> GitHub Release Web / desktop (Windows)
  -> desktop update artifact
  -> Release Web / desktop-deploy (Ubuntu)
  -> SSH/SCP 上传到 Linux
  -> deploy-updates.sh 解压并切换 current
  -> 公网 latest.json 签名/摘要校验
```
```

- 非 `master` 分支和 Pull Request 只触发 `Web CI`，不会部署生产。
- `master` 不触发普通 CI 的 push Job，而是触发 `Release Web`，避免同一提交重复跑完整测试。
- `build` Job 的 `release_id` 和 `artifact_name` 通过 Job outputs 传给 `deploy` Job；部署 Job
  不重新构建，也不在服务器执行 pnpm。
- `release_id` 格式为 `web-v<全局 VERSION>-<提交 SHA 前 12 位>`，所以每个 master 提交都有
  独立目录，可以通过 `previous` 回退。
- `environment: production` 决定部署 Job 读取哪组 Secrets。配置 required reviewers 时，Job
  会在读取生产 Secrets 前暂停；要求推送后立即部署时不要配置审批人。
- Web 脚本先把压缩包解到新目录，再原子切换 `current`。公网健康检查失败时会执行 rollback，
  恢复 `previous`。

## 如何定位失败

- `Web CI` 失败：代码、依赖、类型检查或 E2E 有问题，尚未进入生产部署。
- `Release Web / build` 失败：构建或制品打包失败，服务器不会被访问。
- `Release Web / deploy` 在读取 Secrets 前等待：检查 `production` Environment 的审批规则。
- `Release Web / desktop-deploy` 在读取 Secrets 前等待：检查桌面发布 Job 的 `production`
  Environment 审批状态。
- SSH 配置步骤失败：检查五个 SSH/主机相关 Secrets，以及发布用户的公钥和权限。
- 上传步骤失败：检查 `WEB_RELEASES_DIR`、远程目录权限和服务器 SSH 端口。
- 桌面 Windows 构建失败：检查签名私钥、PyInstaller、更新清单和 Windows Runner 日志；
  Windows Job 不再连接 Linux，也不会产生服务器 SSH 登录。
- 桌面 Linux 发布失败：检查 `KAITOOLS_UPDATE_ROOT`、artifact 下载结果和 `deploy-updates.sh`；
  该阶段使用与 Web 发布相同的 Linux SSH 参数和 `known_hosts`。
- 健康检查失败：检查 Nginx、静态目录 `current` 和 `WEB_HEALTH_URL`；失败后应自动恢复
  `previous`，不要直接删除旧版本。

## GitHub Secrets

以下 Secrets 应保存为 GitHub `production` Environment Secrets，而不是工作流文件：

| 名称 | 用途 |
| --- | --- |
| `DEPLOY_HOST` | Linux 服务器地址 |
| `DEPLOY_USER` | 仅拥有发布目录和受限 systemd 权限的发布用户 |
| `DEPLOY_PORT` | SSH 端口；即使使用默认端口也显式填写 `22` |
| `DEPLOY_SSH_PRIVATE_KEY` | 专用于发布的 Ed25519 私钥 |
| `DEPLOY_SSH_KNOWN_HOSTS` | 已核验的服务器主机密钥行，禁止工作流执行 `ssh-keyscan` |
| `WEB_RELEASES_DIR` | 绝对发布目录，例如 `/srv/kaitools/web` |
| `WEB_HEALTH_URL` | 部署后从 GitHub Runner 访问的 HTTPS 站点地址 |

桌面自动更新还需要以下 `production` Environment Secrets：

| 名称 | 用途 |
| --- | --- |
| `KAITOOLS_UPDATE_SIGNING_PRIVATE_KEY` | 与 `packaging/update-public-key.pem` 匹配的 Ed25519 私钥 |
| `KAITOOLS_UPDATE_ROOT` | 服务器静态更新根目录，例如 `/srv/kaitools-downloads` |

## 服务器准备

首次接入自动发布前，发布目录必须已有一个已验证的历史版本并存在
`current` 软链接。部署脚本会把它记录为 `previous`，随后才切换到新版本；这样健康检查
失败时才能自动回退。目录结构如下：

```text
WEB_RELEASES_DIR/
  current -> /srv/kaitools/web/web-v1.4.13
  previous -> /srv/kaitools/web/web-v1.4.12
  web-v1.4.13/
  .incoming/
```

Nginx 静态根目录应指向 `WEB_RELEASES_DIR/current`，并保持 `/api/` 使用独立的反向代理。
部署用户不需要、也不应拥有修改 Nginx、DNS 或证书的权限。脚本不会删除旧版本；清理策略
应在确认回滚窗口后由运维人员单独执行。

桌面更新目录的 Nginx 路由应将 `/downloads/kaitools/latest.json` 和签名文件指向
`KAITOOLS_UPDATE_ROOT/current/`，并将 `manifests/`、`objects/` 指向更新根目录。桌面发布
Job 与 Web 发布 Job 都由 `master` 推送触发，但分别使用独立的发布目录和校验流程。
