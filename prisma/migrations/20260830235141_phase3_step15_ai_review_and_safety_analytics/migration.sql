-- AlterEnum
ALTER TYPE "SafetyEventSource" ADD VALUE 'AI';

-- AlterTable
ALTER TABLE "ai_observations" ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by" TEXT;

-- AlterTable
ALTER TABLE "safety_events" ADD COLUMN     "source_ai_observation_id" TEXT;

-- CreateTable
CREATE TABLE "ai_safety_policies" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "detection_type" "AIDetectionType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "minimum_confidence" DOUBLE PRECISION NOT NULL,
    "default_severity" "Severity" NOT NULL,
    "requires_human_review" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_safety_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_safety_policies_school_id_detection_type_key" ON "ai_safety_policies"("school_id", "detection_type");

-- CreateIndex
CREATE UNIQUE INDEX "safety_events_source_ai_observation_id_key" ON "safety_events"("source_ai_observation_id");

-- AddForeignKey
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_source_ai_observation_id_fkey" FOREIGN KEY ("source_ai_observation_id") REFERENCES "ai_observations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_observations" ADD CONSTRAINT "ai_observations_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_safety_policies" ADD CONSTRAINT "ai_safety_policies_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_safety_policies" ADD CONSTRAINT "ai_safety_policies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_safety_policies" ADD CONSTRAINT "ai_safety_policies_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security (docs/security.md#3-tenant-isolation). "ai_safety_policies"
-- is tenant-scoped like "safety_rules" — see
-- docs/adr/0022-ai-observation-review-and-safety-analytics.md. No RLS
-- change is needed for "ai_observations" or "safety_events" — both already
-- carry a tenant_isolation policy from prior migrations, and the new
-- columns on each are plain scalar/FK columns, not new tables.
ALTER TABLE "ai_safety_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_safety_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_safety_policies"
  USING ("school_id" = current_setting('app.current_school_id', true));
