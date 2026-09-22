# Production Secrets Inventory

Repository: `i-kaikai/KAItools`
GitHub Actions environment: `production`
Last verified: 2026-09-22 (UTC)

This document records the names and scope of the production Secrets only. It
intentionally contains no values, private keys, host names, paths, or tokens.
GitHub Actions exposes secret names and update timestamps but does not permit
reading secret values after they have been stored.

| Secret | Purpose | Last reported update (UTC) |
| --- | --- | --- |
| `DEPLOY_HOST` | Deployment connection target | 2026-09-21 09:10:13 |
| `DEPLOY_PORT` | Deployment SSH port | 2026-09-21 09:10:15 |
| `DEPLOY_SSH_KNOWN_HOSTS` | SSH host identity verification | 2026-09-21 09:10:21 |
| `DEPLOY_SSH_PRIVATE_KEY` | Deployment SSH authentication | 2026-09-21 09:10:20 |
| `DEPLOY_USER` | Deployment SSH account | 2026-09-21 09:10:14 |
| `WEB_HEALTH_URL` | Post-deployment health check | 2026-09-21 09:10:18 |
| `WEB_RELEASES_DIR` | Managed web release root | 2026-09-21 09:10:17 |
| `KAITOOLS_UPDATE_ROOT` | Desktop update publishing root | 2026-09-22 03:27:17 |
| `KAITOOLS_UPDATE_SIGNING_PRIVATE_KEY` | Desktop update manifest signing key | 2026-09-22 03:43:13 |

## Recovery And Rotation

- GitHub cannot reveal a Secret's stored value. Treat a missing or unknown
  value as unrecoverable.
- Do not attempt to recover credentials from shell history, agent session logs,
  repository history, or CI logs. These are not credential stores.
- Re-establish a known configuration by creating a new deployment key pair,
  installing only its public key on the deployment host, then replacing the
  corresponding GitHub production Secrets.
- Create a new update-signing key only after confirming the client update-key
  migration policy. Replacing it without a migration would invalidate trust in
  previously distributed clients.
- Keep actual secret material in the GitHub production environment or an
  approved secret manager, never in this repository or `.env` files.
