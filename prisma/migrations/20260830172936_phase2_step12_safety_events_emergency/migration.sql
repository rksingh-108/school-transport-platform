-- CreateEnum
CREATE TYPE "SafetyEventType" AS ENUM ('MANUAL_ALERT', 'EMERGENCY_BUTTON', 'CAMERA_ALERT', 'DRIVER_ALERT', 'ATTENDANT_ALERT', 'DOOR_OPEN', 'UNAUTHORIZED_ACCESS', 'MEDICAL', 'ACCIDENT', 'FIGHTING', 'SMOKE_FIRE', 'OTHER');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SafetyEventSource" AS ENUM ('HUMAN_OPERATOR', 'DRIVER', 'ATTENDANT', 'DEVICE', 'CAMERA', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SafetyEventStatus" AS ENUM ('NEW', 'ACKNOWLEDGED', 'DISMISSED', 'ESCALATED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "EmergencyStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EmergencyActionType" AS ENUM ('ACKNOWLEDGED', 'CALLED_CONTACT', 'CONTACTED_SCHOOL', 'CONTACTED_EMERGENCY_SERVICE', 'DISPATCHED_HELP', 'RESOLVED', 'OTHER');

-- CreateTable
CREATE TABLE "safety_events" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "bus_id" TEXT,
    "trip_id" TEXT,
    "camera_id" TEXT,
    "type" "SafetyEventType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "status" "SafetyEventStatus" NOT NULL DEFAULT 'NEW',
    "source" "SafetyEventSource" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "metadata" JSONB,
    "created_by" TEXT NOT NULL,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "safety_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergencies" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "trip_id" TEXT,
    "bus_id" TEXT,
    "initiated_by" TEXT NOT NULL,
    "source_safety_event_id" TEXT,
    "status" "EmergencyStatus" NOT NULL DEFAULT 'ACTIVE',
    "severity" "Severity" NOT NULL,
    "reason" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emergencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_actions" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "emergency_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action_type" "EmergencyActionType" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "safety_events_school_id_occurred_at_idx" ON "safety_events"("school_id", "occurred_at");

-- CreateIndex
CREATE INDEX "safety_events_school_id_status_idx" ON "safety_events"("school_id", "status");

-- CreateIndex
CREATE INDEX "safety_events_school_id_severity_idx" ON "safety_events"("school_id", "severity");

-- CreateIndex
CREATE INDEX "safety_events_bus_id_occurred_at_idx" ON "safety_events"("bus_id", "occurred_at");

-- CreateIndex
CREATE INDEX "safety_events_trip_id_occurred_at_idx" ON "safety_events"("trip_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "emergencies_source_safety_event_id_key" ON "emergencies"("source_safety_event_id");

-- CreateIndex
CREATE INDEX "emergencies_school_id_status_idx" ON "emergencies"("school_id", "status");

-- CreateIndex
CREATE INDEX "emergencies_bus_id_created_at_idx" ON "emergencies"("bus_id", "created_at");

-- CreateIndex
CREATE INDEX "emergencies_trip_id_created_at_idx" ON "emergencies"("trip_id", "created_at");

-- CreateIndex
CREATE INDEX "emergency_actions_emergency_id_created_at_idx" ON "emergency_actions"("emergency_id", "created_at");

-- AddForeignKey
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_bus_id_fkey" FOREIGN KEY ("bus_id") REFERENCES "buses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "cameras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergencies" ADD CONSTRAINT "emergencies_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergencies" ADD CONSTRAINT "emergencies_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergencies" ADD CONSTRAINT "emergencies_bus_id_fkey" FOREIGN KEY ("bus_id") REFERENCES "buses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergencies" ADD CONSTRAINT "emergencies_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergencies" ADD CONSTRAINT "emergencies_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergencies" ADD CONSTRAINT "emergencies_source_safety_event_id_fkey" FOREIGN KEY ("source_safety_event_id") REFERENCES "safety_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_actions" ADD CONSTRAINT "emergency_actions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_actions" ADD CONSTRAINT "emergency_actions_emergency_id_fkey" FOREIGN KEY ("emergency_id") REFERENCES "emergencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_actions" ADD CONSTRAINT "emergency_actions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security (see docs/database.md#5-row-level-security and the
-- hand-written-per-migration convention explained in
-- 20260829200211_init_core_schema/migration.sql). All three tables here are
-- straightforward tenant-scoped tables — nothing looks any of them up
-- pre-tenant (unlike bus_devices' credential-resolution case), so none needs
-- the platform-admin OR-clause.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['safety_events', 'emergencies', 'emergency_actions']
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
