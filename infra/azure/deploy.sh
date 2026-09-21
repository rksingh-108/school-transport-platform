#!/usr/bin/env bash
#
# Deploy the School Transport platform (API + web) to Azure Container Apps and
# verify the deployed health endpoints. Reads its variables from the environment
# — see infra/azure/README.md for the full list.
#
#   set -a; . ./infra/azure/.env.deploy; set +a
#   infra/azure/deploy.sh
#
# The script builds YAML manifests in a private temp directory (mode 0700) and
# deletes them on exit, so no password ever lands on disk. Secrets are pushed
# into the Container App secret store and the container env references them
# with `secretRef`.
#
# Express (single-revision, no-revision-suffix) environments ignore mutations to
# the secret store and the app template, so any change to credentials or env
# values requires RECREATE_API=1 / RECREATE_WEB=1. Image-only refreshes are
# applied in place.
set -euo pipefail

export MSYS_NO_PATHCONV=1

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

log() { printf '\n=== %s ===\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
require() { for v in "$@"; do [[ -n "${!v:-}" ]] || die "missing required env var: $v"; done; }
contain() { for v in "$@"; do [[ "$1" == "$v" ]] && return 0; done; return 1; }

# Best-effort Docker Hub -> ACR mirror for the object store. Docker Hub pulls are
# blocked for some subscriptions, so every step is allowed to fail without
# aborting the deploy: MinIO is already in ACR on every re-run.
mirror_minio_once() {
  docker pull "$MINIO_IMAGE" \
    && docker tag "$MINIO_IMAGE" "$ACR_REGISTRY/minio:latest" \
    && docker push "$ACR_REGISTRY/minio:latest"
}

acr_has_tag() { [[ -n "$(az acr repository show-tags -n "$1" --repository "$2" --query "[?@=='$3']" -o tsv 2>/dev/null || true)" ]]; }

require RG LOC ACR_NAME ACR_REGISTRY CONTAINER_ENV_NAME \
        PG_SERVER APP_DB_USER APP_DB_PASSWORD \
        REDIS_HOST REDIS_PASSWORD \
        MINIO_ROOT_USER MINIO_ROOT_PASSWORD \
        JWT_STAFF_SECRET JWT_PARENT_SECRET

API_APP="${API_APP:-school-transport-api}"
WEB_APP="${WEB_APP:-school-transport-web}"
MINIO_APP="${MINIO_APP:-school-transport-minio}"
MINIO_IMAGE="${MINIO_IMAGE:-minio/minio:latest}"
DB_NAME="${DB_NAME:-school_transport}"
STORAGE_BUCKET="${STORAGE_BUCKET:-school-transport-prod}"
IMAGE_TAG="${IMAGE_TAG:-$(date -u +%Y%m%d%H%M%S)}"
API_IMAGE_TAG="${API_IMAGE_TAG:-$IMAGE_TAG}"
WEB_IMAGE_TAG="${WEB_IMAGE_TAG:-$IMAGE_TAG}"
SKIP_BUILD="${SKIP_BUILD:-0}"
RECREATE_API="${RECREATE_API:-0}"
RECREATE_WEB="${RECREATE_WEB:-0}"
MIRROR_MINIO="${MIRROR_MINIO:-1}"

fqdn_of() { az containerapp show -g "$RG" -n "$1" --query 'properties.configuration.ingress.fqdn' -o tsv 2>/dev/null || true; }
app_exists() { az containerapp show -g "$RG" -n "$1" --query name -o tsv >/dev/null 2>&1; }

log "resolving environment and ingress hostnames"
ENV_ID="$(az containerapp env show -g "$RG" -n "$CONTAINER_ENV_NAME" --query id -o tsv)"
API_FQDN="${API_FQDN:-$(fqdn_of "$API_APP")}"
WEB_FQDN="${WEB_FQDN:-$(fqdn_of "$WEB_APP")}"
MINIO_FQDN="${MINIO_FQDN:-$(fqdn_of "$MINIO_APP")}"
[[ -n "$API_FQDN" ]] || die "could not resolve the API ingress FQDN (export API_FQDN for first-time deploys)"
[[ -n "$WEB_FQDN" ]] || die "could not resolve the web ingress FQDN (export WEB_FQDN for first-time deploys)"
[[ -n "$MINIO_FQDN" ]] || die "could not resolve the MinIO ingress FQDN (export MINIO_FQDN for first-time deploys)"

ACR_USER="$(az acr credential show -n "$ACR_NAME" --query username -o tsv)"
ACR_PASSWORD="$(az acr credential show -n "$ACR_NAME" --query 'passwords[0].value' -o tsv)"

# -------------------------------------------------------------- images --
if [[ "$SKIP_BUILD" != "1" ]]; then
  log "docker login $ACR_REGISTRY"
  printf '%s' "$ACR_PASSWORD" | docker login "$ACR_REGISTRY" -u "$ACR_USER" --password-stdin

  log "building API image"
  docker build -f apps/api/Dockerfile -t "$ACR_REGISTRY/stp-api:$API_IMAGE_TAG" .

  log "building web image (NEXT_PUBLIC_* values are baked in at build time)"
  docker build -f apps/web/Dockerfile \
    --build-arg "NEXT_PUBLIC_API_BASE_URL=https://$API_FQDN/api/v1" \
    --build-arg "NEXT_PUBLIC_WS_BASE_URL=https://$API_FQDN" \
    -t "$ACR_REGISTRY/stp-web:$WEB_IMAGE_TAG" .

  if contain "$MIRROR_MINIO" "1" "yes" "true"; then
    if acr_has_tag "$ACR_NAME" minio latest; then
      log "minio:latest is already in $ACR_REGISTRY — skipping the Docker Hub mirror"
    else
      log "mirroring minio:latest into ACR (best-effort — Docker Hub pulls are blocked for some subscriptions)"
      mirror_minio_once \
        || log "minio mirror failed — push $ACR_REGISTRY/minio:latest from your workstation first; continuing"
    fi
  fi

  log "pushing app images"
  docker push "$ACR_REGISTRY/stp-api:$API_IMAGE_TAG"
  docker push "$ACR_REGISTRY/stp-web:$WEB_IMAGE_TAG"
else
  log "SKIP_BUILD=1 — reusing $ACR_REGISTRY/stp-api:$API_IMAGE_TAG and $ACR_REGISTRY/stp-web:$WEB_IMAGE_TAG"
  acr_has_tag "$ACR_NAME" stp-api "$API_IMAGE_TAG" \
    || die "$ACR_REGISTRY/stp-api:$API_IMAGE_TAG is not in ACR — push it first or drop SKIP_BUILD=1"
  acr_has_tag "$ACR_NAME" stp-web "$WEB_IMAGE_TAG" \
    || die "$ACR_REGISTRY/stp-web:$WEB_IMAGE_TAG is not in ACR — push it first or drop SKIP_BUILD=1"
fi

# -------------------------------------------------------------- secrets --
urlencode() {
  if command -v node >/dev/null 2>&1; then
    node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"
  else
    printf '%s' "$1"
  fi
}
APP_DB_PASSWORD_ENCODED="$(urlencode "$APP_DB_PASSWORD")"
REDIS_PASSWORD_ENCODED="$(urlencode "$REDIS_PASSWORD")"
DATABASE_URL="postgresql://$APP_DB_USER:$APP_DB_PASSWORD_ENCODED@$PG_SERVER.postgres.database.azure.com:5432/$DB_NAME?schema=public&sslmode=require"
REDIS_URL="rediss://:$REDIS_PASSWORD_ENCODED@$REDIS_HOST:10000"

# A fresh per-deploy secret forces a rollout without baking the value into any
# manifest file; the actual value lives only in the Container App secret store.
ACRPASS_RANDOM="$(openssl rand -hex 8 2>/dev/null || python -c 'import secrets,os;print(os.urandom(8).hex())' 2>/dev/null || echo "deploy-$IMAGE_TAG")"

TMPDIR_MANIFESTS="$(mktemp -d)"
TMPDIR_MANIFESTS="$(cd "$TMPDIR_MANIFESTS" && { pwd -W 2>/dev/null || pwd; })"
chmod 700 "$TMPDIR_MANIFESTS"
trap 'rm -rf "$TMPDIR_MANIFESTS"' EXIT

# ----------------------------------------------------- MinIO (object store) --
if app_exists "$MINIO_APP"; then
  log "$MINIO_APP already exists — leave it as-is (data is in /data and will be lost if you delete/recreate the app)"
else
  log "creating $MINIO_APP (internal ingress + built-in minio image)"
  cat > "$TMPDIR_MANIFESTS/minio.yaml" <<EOF
name: $MINIO_APP
location: $LOC
properties:
  managedEnvironmentId: $ENV_ID
  configuration:
    activeRevisionsMode: Single
    ingress:
      external: false
      targetPort: 9000
      transport: Http
    registries:
      - server: $ACR_REGISTRY
        username: $ACR_USER
        passwordSecretRef: acr-password
    secrets:
      - name: acr-password
        value: "$ACR_PASSWORD"
      - name: minio-root-user
        value: "$MINIO_ROOT_USER"
      - name: minio-root-password
        value: "$MINIO_ROOT_PASSWORD"
  template:
    containers:
      - name: $MINIO_APP
        image: $ACR_REGISTRY/minio:latest
        args: ["server", "/data", "--console-address", ":9001"]
        resources:
          cpu: 0.5
          memory: 1.0Gi
        env:
          - name: MINIO_ROOT_USER
            secretRef: minio-root-user
          - name: MINIO_ROOT_PASSWORD
            secretRef: minio-root-password
        probes:
          - type: liveness
            httpGet:
              path: /minio/health/live
              port: 9000
              scheme: HTTP
            initialDelaySeconds: 10
            periodSeconds: 20
            failureThreshold: 5
          - type: readiness
            httpGet:
              path: /minio/health/ready
              port: 9000
              scheme: HTTP
            initialDelaySeconds: 5
            periodSeconds: 15
            failureThreshold: 6
    scale:
      minReplicas: 1
      maxReplicas: 1
EOF

  az containerapp create -g "$RG" -n "$MINIO_APP" --yaml "$TMPDIR_MANIFESTS/minio.yaml" >/dev/null
  echo "created — create the '$STORAGE_BUCKET' bucket next (infra/azure/README.md §6)"
fi

# ----------------------------------------------------------------- API app --
log "deploying $API_APP (:$API_IMAGE_TAG)"
cat > "$TMPDIR_MANIFESTS/api.yaml" <<EOF
name: $API_APP
location: $LOC
properties:
  managedEnvironmentId: $ENV_ID
  configuration:
    activeRevisionsMode: Single
    ingress:
      external: true
      targetPort: 3001
      transport: Http
      allowInsecure: false
    registries:
      - server: $ACR_REGISTRY
        username: $ACR_USER
        passwordSecretRef: acr-password
    secrets:
      - name: acr-password
        value: "$ACR_PASSWORD"
      - name: database-url
        value: "$DATABASE_URL"
      - name: redis-url
        value: "$REDIS_URL"
      - name: storage-access-key
        value: "$MINIO_ROOT_USER"
      - name: storage-secret-key
        value: "$MINIO_ROOT_PASSWORD"
      - name: jwt-staff-secret
        value: "$JWT_STAFF_SECRET"
      - name: jwt-parent-secret
        value: "$JWT_PARENT_SECRET"
  template:
    containers:
      - name: $API_APP
        image: $ACR_REGISTRY/stp-api:$API_IMAGE_TAG
        resources:
          cpu: 1.0
          memory: 2.0Gi
        env:
          - name: NODE_ENV
            value: production
          - name: API_PORT
            value: "3001"
          - name: DEPLOY_NONCE
            value: "$ACRPASS_RANDOM"
          - name: CORS_ORIGIN
            value: "https://$WEB_FQDN"
          - name: API_DATABASE_URL
            secretRef: database-url
          - name: REDIS_URL
            secretRef: redis-url
          - name: STORAGE_ENDPOINT
            value: "$MINIO_FQDN"
          - name: STORAGE_PORT
            value: "443"
          - name: STORAGE_USE_SSL
            value: "true"
          - name: STORAGE_ACCESS_KEY
            secretRef: storage-access-key
          - name: STORAGE_SECRET_KEY
            secretRef: storage-secret-key
          - name: STORAGE_BUCKET
            value: "$STORAGE_BUCKET"
          - name: JWT_STAFF_SECRET
            secretRef: jwt-staff-secret
          - name: JWT_PARENT_SECRET
            secretRef: jwt-parent-secret
          - name: JWT_ISSUER
            value: school-transport-platform
          - name: JWT_STAFF_AUDIENCE
            value: school-transport-staff
          - name: JWT_PARENT_AUDIENCE
            value: school-transport-parent
        probes:
          - type: liveness
            httpGet:
              path: /health
              port: 3001
              scheme: HTTP
            initialDelaySeconds: 15
            periodSeconds: 20
            timeoutSeconds: 5
            failureThreshold: 5
          - type: readiness
            httpGet:
              path: /health/ready
              port: 3001
              scheme: HTTP
            initialDelaySeconds: 10
            periodSeconds: 15
            timeoutSeconds: 5
            failureThreshold: 6
    scale:
      minReplicas: 1
      maxReplicas: 3
      rules:
        - name: http-scaler
          http:
            metadata:
              concurrentRequests: "20"
EOF

if [[ "$RECREATE_API" == "1" ]] && app_exists "$API_APP"; then
  log "recreating $API_APP (express environments ignore secret/template updates on an existing app)"
  az containerapp delete -g "$RG" -n "$API_APP" --yes >/dev/null
fi

if app_exists "$API_APP"; then
  az containerapp update -g "$RG" -n "$API_APP" --yaml "$TMPDIR_MANIFESTS/api.yaml" >/dev/null
else
  az containerapp create -g "$RG" -n "$API_APP" --yaml "$TMPDIR_MANIFESTS/api.yaml" >/dev/null
fi

# ----------------------------------------------------------------- web app --
log "deploying $WEB_APP (:$WEB_IMAGE_TAG)"
cat > "$TMPDIR_MANIFESTS/web.yaml" <<EOF
name: $WEB_APP
location: $LOC
properties:
  managedEnvironmentId: $ENV_ID
  configuration:
    activeRevisionsMode: Single
    ingress:
      external: true
      targetPort: 3000
      transport: Http
      allowInsecure: false
    registries:
      - server: $ACR_REGISTRY
        username: $ACR_USER
        passwordSecretRef: acr-password
    secrets:
      - name: acr-password
        value: "$ACR_PASSWORD"
  template:
    containers:
      - name: $WEB_APP
        image: $ACR_REGISTRY/stp-web:$WEB_IMAGE_TAG
        resources:
          cpu: 0.5
          memory: 1.0Gi
        env:
          - name: NODE_ENV
            value: production
          - name: PORT
            value: "3000"
          - name: HOSTNAME
            value: "0.0.0.0"
          - name: DEPLOY_NONCE
            value: "$ACRPASS_RANDOM"
        probes:
          - type: liveness
            httpGet:
              path: /
              port: 3000
              scheme: HTTP
            initialDelaySeconds: 15
            periodSeconds: 30
            timeoutSeconds: 5
            failureThreshold: 5
          - type: readiness
            httpGet:
              path: /login/staff
              port: 3000
              scheme: HTTP
            initialDelaySeconds: 10
            periodSeconds: 15
            timeoutSeconds: 5
            failureThreshold: 6
    scale:
      minReplicas: 1
      maxReplicas: 3
      rules:
        - name: http-scaler
          http:
            metadata:
              concurrentRequests: "50"
EOF

if [[ "$RECREATE_WEB" == "1" ]] && app_exists "$WEB_APP"; then
  log "recreating $WEB_APP"
  az containerapp delete -g "$RG" -n "$WEB_APP" --yes >/dev/null
fi

if app_exists "$WEB_APP"; then
  az containerapp update -g "$RG" -n "$WEB_APP" --yaml "$TMPDIR_MANIFESTS/web.yaml" >/dev/null
else
  az containerapp create -g "$RG" -n "$WEB_APP" --yaml "$TMPDIR_MANIFESTS/web.yaml" >/dev/null
fi

# ---------------------------------------------------------------- verify --
log "waiting for revisions to become healthy"
for _ in $(seq 1 20); do
  api_h="$(az containerapp revision list -g "$RG" -n "$API_APP" --query "[0].properties.healthState" -o tsv 2>/dev/null || echo Unknown)"
  web_h="$(az containerapp revision list -g "$RG" -n "$WEB_APP" --query "[0].properties.healthState" -o tsv 2>/dev/null || echo Unknown)"
  echo "  api=$api_h web=$web_h"
  if contain "$api_h" "Healthy"; then break; fi
  sleep 15
done

log "health checks"
printf 'API liveness  '; curl -fsS --max-time 30 "https://$API_FQDN/health" | head -c 200; echo
printf 'API readiness '; curl -fsS --max-time 30 "https://$API_FQDN/health/ready" | head -c 500; echo
curl -fsS -o /dev/null -w "web /login/staff -> %{http_code}\n" --max-time 30 "https://$WEB_FQDN/login/staff"

log "done"
printf 'API  https://%s\nWEB  https://%s\nAPI IMG :%s  WEB IMG :%s\n' "$API_FQDN" "$WEB_FQDN" "$API_IMAGE_TAG" "$WEB_IMAGE_TAG"
