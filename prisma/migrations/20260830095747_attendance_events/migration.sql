-- AlterTable
-- attendance_events has zero rows in any environment this migrates (no
-- attendance feature existed before Phase 1 Step 6), so trip_id NOT NULL
-- needs no backfill default.
ALTER TABLE "attendance_events" ADD COLUMN     "corrects_event_id" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "trip_id" TEXT NOT NULL,
ADD COLUMN     "trip_stop_id" TEXT,
ALTER COLUMN "source" SET DEFAULT 'ATTENDANT_APP';

-- CreateIndex
CREATE INDEX "attendance_events_trip_id_occurred_at_idx" ON "attendance_events"("trip_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_trip_stop_id_fkey" FOREIGN KEY ("trip_stop_id") REFERENCES "trip_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_corrects_event_id_fkey" FOREIGN KEY ("corrects_event_id") REFERENCES "attendance_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
-- Denormalized projection alongside the existing current_status column —
-- written only by AttendanceService, never directly by TripStudentsService.
ALTER TABLE "trip_students" ADD COLUMN     "boarded_at" TIMESTAMP(3),
ADD COLUMN     "dropped_off_at" TIMESTAMP(3);
