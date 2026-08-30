-- Phase 1 Step 9: notifications + alerts. Rewrites the Phase 0 scaffold
-- (`notifications`/`notification_preferences` had zero rows in any
-- environment) into the real shape: Notification (logical record) +
-- NotificationDelivery (new, per-channel tracking) — see
-- docs/adr/0016-notifications-and-alerts.md.

-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('CHILD_BOARDED', 'CHILD_DROPPED_OFF', 'TRIP_CANCELLED', 'TRIP_NO_SHOW', 'GPS_STALE', 'GPS_OFFLINE');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED', 'NOT_CONFIGURED');

-- DropIndex
DROP INDEX "notification_preferences_parent_id_event_type_channel_key";

-- DropIndex
DROP INDEX "notifications_school_id_recipient_type_recipient_id_idx";

-- AlterTable
ALTER TABLE "notification_preferences" DROP COLUMN "event_type",
ADD COLUMN     "school_id" TEXT NOT NULL,
DROP COLUMN "channel",
ADD COLUMN     "channel" "NotificationChannel" NOT NULL;

-- AlterTable
ALTER TABLE "notifications" DROP COLUMN "channel",
DROP COLUMN "sent_at",
DROP COLUMN "status",
ADD COLUMN     "body" TEXT NOT NULL,
ADD COLUMN     "entity_id" TEXT NOT NULL,
ADD COLUMN     "entity_type" TEXT NOT NULL,
ADD COLUMN     "read_at" TIMESTAMP(3),
ADD COLUMN     "title" TEXT NOT NULL,
DROP COLUMN "event_type",
ADD COLUMN     "event_type" "NotificationEventType" NOT NULL,
ALTER COLUMN "payload" DROP NOT NULL;

-- DropEnum
DROP TYPE "NotificationStatus";

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "provider_message_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notification_id_channel_key" ON "notification_deliveries"("notification_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_parent_id_channel_key" ON "notification_preferences"("parent_id", "channel");

-- CreateIndex
CREATE INDEX "notifications_school_id_recipient_type_recipient_id_created_idx" ON "notifications"("school_id", "recipient_type", "recipient_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_school_id_recipient_type_recipient_id_read_at_idx" ON "notifications"("school_id", "recipient_type", "recipient_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_school_id_event_type_entity_id_recipient_type_key" ON "notifications"("school_id", "event_type", "entity_id", "recipient_type", "recipient_id");

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security for the new table. `notifications` itself was already
-- RLS-enabled by the generic tenant_isolation loop in the initial
-- migration; `notification_deliveries` is new and needs the same plain
-- (no platform-admin bypass — nothing looks it up pre-tenant) policy.
ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notification_deliveries"
  USING ("school_id" = current_setting('app.current_school_id', true));

-- `notification_preferences` was a Phase 0 gap: it was never added to the
-- generic tenant-isolation loop at all (it had no school_id column to key
-- on) and so has had zero RLS protection since Phase 0. Fixed now that a
-- real school_id column exists, while wiring this feature up for real —
-- the same class of correction as bus_devices' RLS gap found in Phase 1
-- Step 7 (see docs/adr/0010-credential-resolution-rls-bypass.md's
-- "Extension" section) and TRANSPORT_MANAGER's fleet-visibility gap in
-- Phase 1 Step 3.
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notification_preferences"
  USING ("school_id" = current_setting('app.current_school_id', true));
