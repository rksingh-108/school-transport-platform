-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PLANNED', 'ACTIVE', 'REMOVED');

-- AlterEnum
-- Adding TripStatus values only — nothing in this migration inserts/updates
-- a row using them, so there is no same-transaction usage restriction to
-- work around (Postgres 12+ permits ADD VALUE inside a transaction anyway).
ALTER TYPE "TripStatus" ADD VALUE 'READY';
ALTER TYPE "TripStatus" ADD VALUE 'NO_SHOW';

-- DropForeignKey
-- trip_students.stop_id (-> route_stops, a live/mutable record) is replaced
-- by pickup_trip_stop_id/dropoff_trip_stop_id (-> trip_stops, an immutable
-- per-trip snapshot) below — see the ADR for why.
ALTER TABLE "trip_students" DROP CONSTRAINT "trip_students_stop_id_fkey";

-- AlterTable
-- No existing rows in trips/trip_students yet (no Trip has been created in
-- any prior phase), so the new NOT NULL columns below need no backfill
-- default.
ALTER TABLE "trip_students" DROP COLUMN "stop_id",
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "dropoff_trip_stop_id" TEXT,
ADD COLUMN     "membership_status" "MembershipStatus" NOT NULL DEFAULT 'PLANNED',
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "pickup_trip_stop_id" TEXT;

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "cancellation_reason" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "scheduled_end_time" TEXT NOT NULL,
ADD COLUMN     "scheduled_start_time" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "trip_stops" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "source_route_stop_id" TEXT,
    "sequence_no" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "expected_offset_minutes" INTEGER NOT NULL,
    "mode" "StopMode" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_stops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_stops_school_id_idx" ON "trip_stops"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stops_trip_id_sequence_no_key" ON "trip_stops"("trip_id", "sequence_no");

-- CreateIndex
CREATE INDEX "trips_driver_id_service_date_idx" ON "trips"("driver_id", "service_date");

-- CreateIndex
CREATE INDEX "trips_attendant_id_service_date_idx" ON "trips"("attendant_id", "service_date");

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_source_route_stop_id_fkey" FOREIGN KEY ("source_route_stop_id") REFERENCES "route_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_students" ADD CONSTRAINT "trip_students_pickup_trip_stop_id_fkey" FOREIGN KEY ("pickup_trip_stop_id") REFERENCES "trip_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_students" ADD CONSTRAINT "trip_students_dropoff_trip_stop_id_fkey" FOREIGN KEY ("dropoff_trip_stop_id") REFERENCES "trip_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security for the new trip_stops table — plain tenant isolation,
-- never queried via runAsPlatformAdmin, matching every other genuinely
-- tenant-scoped table added since Phase 0 (see docs/database.md #5).
ALTER TABLE "trip_stops" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trip_stops" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "trip_stops"
  USING ("school_id" = current_setting('app.current_school_id', true));
