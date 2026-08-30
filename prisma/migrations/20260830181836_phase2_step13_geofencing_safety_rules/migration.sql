-- CreateEnum
CREATE TYPE "GeofenceType" AS ENUM ('SCHOOL', 'DEPOT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "GeofenceStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SafetyRuleType" AS ENUM ('ROUTE_DEVIATION', 'GEOFENCE', 'SPEED', 'STOP');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SafetyEventType" ADD VALUE 'ROUTE_DEVIATION';
ALTER TYPE "SafetyEventType" ADD VALUE 'GEOFENCE_ENTRY';
ALTER TYPE "SafetyEventType" ADD VALUE 'GEOFENCE_EXIT';
ALTER TYPE "SafetyEventType" ADD VALUE 'EXCESSIVE_SPEED';
ALTER TYPE "SafetyEventType" ADD VALUE 'UNEXPECTED_STOP';

-- DropForeignKey
ALTER TABLE "safety_events" DROP CONSTRAINT "safety_events_created_by_fkey";

-- AlterTable
ALTER TABLE "safety_events" ALTER COLUMN "created_by" DROP NOT NULL;

-- CreateTable
CREATE TABLE "geofences" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GeofenceType" NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radius_meters" INTEGER NOT NULL,
    "status" "GeofenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geofences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_rules" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "type" "SafetyRuleType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "severity" "Severity" NOT NULL,
    "geofence_id" TEXT,
    "route_id" TEXT,
    "bus_id" TEXT,
    "threshold_meters" INTEGER,
    "threshold_speed_kmh" INTEGER,
    "min_consecutive_points" INTEGER NOT NULL DEFAULT 3,
    "cooldown_seconds" INTEGER NOT NULL DEFAULT 300,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "safety_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "geofences_school_id_status_idx" ON "geofences"("school_id", "status");

-- CreateIndex
CREATE INDEX "safety_rules_school_id_type_idx" ON "safety_rules"("school_id", "type");

-- CreateIndex
CREATE INDEX "safety_rules_school_id_enabled_idx" ON "safety_rules"("school_id", "enabled");

-- AddForeignKey
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_rules" ADD CONSTRAINT "safety_rules_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_rules" ADD CONSTRAINT "safety_rules_geofence_id_fkey" FOREIGN KEY ("geofence_id") REFERENCES "geofences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_rules" ADD CONSTRAINT "safety_rules_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_rules" ADD CONSTRAINT "safety_rules_bus_id_fkey" FOREIGN KEY ("bus_id") REFERENCES "buses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_rules" ADD CONSTRAINT "safety_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_rules" ADD CONSTRAINT "safety_rules_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security (see docs/database.md#5-row-level-security and the
-- hand-written-per-migration convention explained in
-- 20260829200211_init_core_schema/migration.sql). Both tables here are
-- straightforward tenant-scoped tables — neither is ever queried
-- pre-tenant, so neither needs the platform-admin OR-clause.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['geofences', 'safety_rules']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("school_id" = current_setting(''app.current_school_id'', true))',
      t
    );
  END LOOP;
END
$$;
