#!/bin/bash
# Runs once, automatically, the first time the postgres container initializes an
# empty data volume (standard postgres image docker-entrypoint-initdb.d behavior).
#
# Creates the restricted `app_user` role that apps/api connects as at runtime.
# It is intentionally NOT the table owner and does not have BYPASSRLS, so the
# Row-Level Security policies created in the Prisma migration
# (prisma/migrations/*_add_row_level_security/migration.sql) actually apply to
# it — see docs/database.md#5-row-level-security and
# docs/adr/0002-multi-tenancy-strategy.md.
#
# Table-level GRANTs for app_user are issued from the migration SQL itself (they
# need the tables to exist first); this script only needs to guarantee the role
# exists before that migration runs.
set -euo pipefail

: "${APP_DB_USER:?APP_DB_USER must be set}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${APP_DB_USER}') THEN
      CREATE ROLE ${APP_DB_USER} WITH LOGIN PASSWORD '${APP_DB_PASSWORD}';
    END IF;
  END
  \$\$;

  GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO ${APP_DB_USER};
EOSQL
