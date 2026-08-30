-- CreateEnum
CREATE TYPE "AIModelType" AS ENUM ('OBJECT_DETECTION', 'POSE_ESTIMATION', 'ACTION_RECOGNITION', 'SMOKE_FIRE_DETECTION');

-- CreateEnum
CREATE TYPE "AIModelStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "AIDetectionType" AS ENUM ('PERSON_DETECTED', 'PERSON_COUNT', 'OBJECT_DETECTED', 'FALL_DETECTED', 'SMOKE_DETECTED', 'FIRE_DETECTED', 'DOOR_STATE_DETECTED', 'UNUSUAL_MOTION');

-- CreateEnum
CREATE TYPE "AIObservationStatus" AS ENUM ('CANDIDATE', 'REVIEWED', 'DISMISSED', 'PROMOTED');

-- AlterTable
ALTER TABLE "cameras" ADD COLUMN     "edge_device_id" TEXT;

-- CreateTable
CREATE TABLE "ai_models" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model_type" "AIModelType" NOT NULL,
    "status" "AIModelStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_observations" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "bus_id" TEXT NOT NULL,
    "trip_id" TEXT,
    "camera_id" TEXT NOT NULL,
    "edge_device_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "model_version" TEXT NOT NULL,
    "detection_type" "AIDetectionType" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "window_start" TIMESTAMP(3) NOT NULL,
    "status" "AIObservationStatus" NOT NULL DEFAULT 'CANDIDATE',
    "evidence_reference" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_name_version_key" ON "ai_models"("name", "version");

-- CreateIndex
CREATE INDEX "ai_observations_school_id_occurred_at_idx" ON "ai_observations"("school_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ai_observations_camera_id_occurred_at_idx" ON "ai_observations"("camera_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ai_observations_bus_id_occurred_at_idx" ON "ai_observations"("bus_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ai_observations_trip_id_occurred_at_idx" ON "ai_observations"("trip_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ai_observations_detection_type_occurred_at_idx" ON "ai_observations"("detection_type", "occurred_at");

-- CreateIndex
CREATE INDEX "ai_observations_status_occurred_at_idx" ON "ai_observations"("status", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_observations_edge_device_id_camera_id_detection_type_win_key" ON "ai_observations"("edge_device_id", "camera_id", "detection_type", "window_start");

-- CreateIndex
CREATE INDEX "cameras_edge_device_id_idx" ON "cameras"("edge_device_id");

-- AddForeignKey
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_edge_device_id_fkey" FOREIGN KEY ("edge_device_id") REFERENCES "bus_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_observations" ADD CONSTRAINT "ai_observations_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_observations" ADD CONSTRAINT "ai_observations_bus_id_fkey" FOREIGN KEY ("bus_id") REFERENCES "buses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_observations" ADD CONSTRAINT "ai_observations_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_observations" ADD CONSTRAINT "ai_observations_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "cameras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_observations" ADD CONSTRAINT "ai_observations_edge_device_id_fkey" FOREIGN KEY ("edge_device_id") REFERENCES "bus_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_observations" ADD CONSTRAINT "ai_observations_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security (docs/security.md#3-tenant-isolation). "ai_observations"
-- is tenant-scoped like every other operational table. "ai_models" is
-- deliberately NOT given a policy here — it has no school_id column at all
-- (a platform-wide, shared ML asset registry, same precedent as the
-- pre-existing "permissions" table) — see
-- docs/adr/0021-edge-ai-computer-vision-pipeline-foundation.md.
ALTER TABLE "ai_observations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_observations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_observations"
  USING ("school_id" = current_setting('app.current_school_id', true));
