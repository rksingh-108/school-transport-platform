-- CreateEnum
CREATE TYPE "AuthPrincipalType" AS ENUM ('STAFF', 'PARENT');

-- CreateEnum
CREATE TYPE "TokenRevokeReason" AS ENUM ('ROTATED', 'LOGOUT', 'LOGOUT_ALL', 'REUSE_DETECTED', 'PASSWORD_CHANGED', 'ACCOUNT_SUSPENDED', 'EXPIRED_CLEANUP');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccountStatus" ADD VALUE 'INVITED';
ALTER TYPE "AccountStatus" ADD VALUE 'SUSPENDED';

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "principal_type" "AuthPrincipalType" NOT NULL,
    "principal_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" "TokenRevokeReason",
    "replaced_by_token_id" TEXT,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "principal_type" "AuthPrincipalType" NOT NULL,
    "principal_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "requested_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_replaced_by_token_id_key" ON "refresh_tokens"("replaced_by_token_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_school_id_idx" ON "refresh_tokens"("school_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_principal_type_principal_id_idx" ON "refresh_tokens"("principal_type", "principal_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_school_id_idx" ON "password_reset_tokens"("school_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_principal_type_principal_id_idx" ON "password_reset_tokens"("principal_type", "principal_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_token_id_fkey" FOREIGN KEY ("replaced_by_token_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Row-Level Security for the new authentication tables
--
-- Table-level GRANTs for app_user are already covered by the
-- `ALTER DEFAULT PRIVILEGES` statements from the initial migration (they
-- apply to tables created later by the same migration role) — only RLS
-- enable/force/policy needs to be added here, same pattern as
-- prisma/migrations/20260829200211_init_core_schema/migration.sql.
--
-- IMPORTANT — corrected from an earlier draft of this migration: these two
-- tables ARE looked up by their unique token_hash before the caller's tenant
-- is known, via PrismaService.runAsPlatformAdmin() (docs/adr/0010). Setting
-- `app.is_platform_admin = 'true'` only has an effect on a table whose OWN
-- policy checks that setting — FORCE ROW LEVEL SECURITY means `app_user`
-- (the role runAsPlatformAdmin still runs as — it changes a session
-- variable, not the database role) is subject to whatever policy a table
-- actually has. A policy that only checks `app.current_school_id` (never set
-- by runAsPlatformAdmin) rejects every row regardless, which broke every
-- login/refresh/reset flow until this fix. The policies below — and the
-- corrected `users`/`parents` policies further down, which were originally
-- created in the initial migration without this clause — now match the
-- `schools`/`audit_logs` pattern: tenant-scoped OR explicit platform-admin.
-- ===========================================================================

ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "refresh_tokens"
  USING (
    "school_id" = current_setting('app.current_school_id', true)
    OR coalesce(current_setting('app.is_platform_admin', true), 'false') = 'true'
  );

ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "password_reset_tokens"
  USING (
    "school_id" = current_setting('app.current_school_id', true)
    OR coalesce(current_setting('app.is_platform_admin', true), 'false') = 'true'
  );

-- Fixes the `users` and `parents` policies from the initial migration
-- (prisma/migrations/20260829200211_init_core_schema/migration.sql), which
-- predate the platform-admin credential-resolution pattern and only checked
-- `app.current_school_id`. AuthService.loginStaff/loginParent resolve a
-- login identifier across tenants via runAsPlatformAdmin — see
-- docs/adr/0010-credential-resolution-rls-bypass.md — so these two tables
-- need the same OR-clause `schools`/`audit_logs` already have. The original
-- migration file is left untouched (it's already applied/committed); this
-- is a normal, later ALTER of a policy, same as any other schema evolution.
DROP POLICY tenant_isolation ON "users";
CREATE POLICY tenant_isolation ON "users"
  USING (
    "school_id" = current_setting('app.current_school_id', true)
    OR coalesce(current_setting('app.is_platform_admin', true), 'false') = 'true'
  );

DROP POLICY tenant_isolation ON "parents";
CREATE POLICY tenant_isolation ON "parents"
  USING (
    "school_id" = current_setting('app.current_school_id', true)
    OR coalesce(current_setting('app.is_platform_admin', true), 'false') = 'true'
  );
