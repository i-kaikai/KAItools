# GitHub Actions Web Pipeline

本仓库的 GitHub Actions 只负责构建、测试和上传浏览器制品。Windows EXE 仍应由独立的
Windows Runner 在发布标签上构建，不能在 Linux Web 发布任务中生成或覆盖用户数据。

## 工作流

- `Web CI` 在推送和 Pull Request 时运行 Node 24、Python 3.13、前端类型检查、单元测试、
  两套 Playwright 测试、浏览器构建和 Python 测试。成功后保留 7 天 `build/web` 制品。
- `Release Web` 仅能手动输入已存在的 `web-vx.y.z` 标签和确认词 `DEPLOY` 执行。标签必须与
  `VERSION` 一致；流水线重新验证并构建一次，再将同一制品交给部署任务。

生产发布任务使用 GitHub `production` Environment。请配置 required reviewers、Prevent
self-review，并将允许发布的标签限制为 `web-v*`。这样公开仓库可以保持 CI 对外可见，但部署
任务必须经过审批后才能读取生产 Secrets。

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
