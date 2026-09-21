# Azure deployment runbook

The platform runs on **Azure Container Apps** in the `school-transport-rg`
resource group (region `eastasia`).

## One-time provisioning

```bash
# infra/azure/.env.deploy (git-ignored) holds the current values for this
# account's infrastructure. We never write real secrets to disk.

RG=school-transport-rg
LOC=eastasia
ACR_NAME=schooltransportacr108
ACR_REGISTRY=schooltransportacr108.azurecr.io
CONTAINER_ENV_NAME=school-transport-env
PG_SERVER=school-transport-pg108
APP_DB_USER=app_user
APP_DB_PASSWORD=change-me
REDIS_HOST=school-transport-redis108.eastasia.redis.azure.net
REDIS_PASSWORD=change-me
MINIO_ROOT_USER=change-me
MINIO_ROOT_PASSWORD=change-me
JWT_STAFF_SECRET=change-me
JWT_PARENT_SECRET=change-me
BOOTSTRAP_ADMIN_EMAIL=platform.admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=change-me
BOOTSTRAP_SCHOOL_NAME=Example School
BOOTSTRAP_SCHOOL_SLUG=example-school
BOOTSTRAP_SCHOOL_ADMIN_EMAIL=school.admin@example.com
BOOTSTRAP_SCHOOL_ADMIN_PASSWORD=change-me
BOOTSTRAP_SCHOOL_ADMIN_NAME=School Administrator
```

Re-apply the seed RBAC (idempotent; never writes demo data):

```bash
DATABASE_URL="postgresql://$APP_DB_USER:$APP_DB_PASSWORD@$PG_SERVER.postgres.database.azure.com:5432/school_transport?sslmode=require" \
  pnpm exec tsx prisma/bootstrap.ts
```

The deploy command:

```bash
set -a; . ./infra/azure/.env.deploy; set +a
infra/azure/deploy.sh
```

The script builds `stp-api` and `stp-web` from the repo root, mirrors
`minio:latest` into ACR (the Container Apps platform cannot pull from Docker
Hub in this subscription), applies the Container App manifests, waits for both
revisions to become healthy, and probes the live health endpoints.

**Important caveat**: the `minio:latest` mirror uses `docker tag` + `docker
push` into ACR, so it works even when Docker Hub pulls are blocked for the
workstation. If the mirror fails with *pull access denied*, push
`schooltransportacr108.azurecr.io/minio:latest` from a machine that can reach
Docker Hub first, or set `MIRROR_MINIO=0` and push the image manually before
deploying.

## Verification

After a deploy, confirm:

- `curl -fsS https://<api-fqdn>/health` returns `{"status":"ok"}`
- `curl -fsS https://<api-fqdn>/health/ready` reports database, redis, and
  storage all "up"
- `curl -fsS -o /dev/null -w "%{http_code}" https://<web-fqdn>/login/staff`
  returns 200

## Notes

- Secrets are never written to disk. The manifests are built in a Bash `mktemp`
  directory and deleted on exit; real values live in the Container App secret
  store and are referenced from the container env by `secretRef`.
- Express (single-revision) environments ignore secret and template updates on
  an existing app, so any change to credentials or env vars requires
  `RECREATE_API=1` / `RECREATE_WEB=1`.
- The `api` image runs the NestJS process on port 3001; the `web` image runs
  Next.js on port 3000.
