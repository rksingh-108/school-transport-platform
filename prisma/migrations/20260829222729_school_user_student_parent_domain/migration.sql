-- AlterEnum
ALTER TYPE "SchoolStatus" ADD VALUE 'INACTIVE';

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "principal_type" "AuthPrincipalType" NOT NULL,
    "principal_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_school_id_idx" ON "invitations"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_principal_type_principal_id_key" ON "invitations"("principal_type", "principal_id");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Row-Level Security for invitations
--
-- The invitee is not authenticated when they open their invite link, so
-- InvitationsService looks the row up by token hash via
-- PrismaService.runAsPlatformAdmin() before any tenant context exists — same
-- shape as refresh_tokens/password_reset_tokens. Per the rule in
-- docs/database.md#5-row-level-security ("every table queried via
-- runAsPlatformAdmin must carry this clause"), this policy includes the
-- platform-admin OR-clause from the start, rather than being added later as
-- a correction (see docs/adr/0010-credential-resolution-rls-bypass.md's
-- implementation-correction note for why that omission is a real, previously
-- observed bug class, not a hypothetical one).
-- ===========================================================================

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "invitations"
  USING (
    "school_id" = current_setting('app.current_school_id', true)
    OR coalesce(current_setting('app.is_platform_admin', true), 'false') = 'true'
  );
