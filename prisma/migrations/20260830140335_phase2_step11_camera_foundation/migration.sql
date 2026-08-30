-- CreateEnum
CREATE TYPE "CameraPosition" AS ENUM ('FRONT', 'CABIN', 'REAR', 'LEFT', 'RIGHT', 'DOOR', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CameraStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'FAULT', 'RETIRED');

-- CreateEnum
CREATE TYPE "CameraStreamType" AS ENUM ('NONE', 'RTSP', 'HLS', 'WEBRTC', 'VENDOR');

-- AlterEnum
ALTER TYPE "DeviceType" ADD VALUE 'CAMERA_CONTROLLER';

-- CreateTable
CREATE TABLE "cameras" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "bus_id" TEXT NOT NULL,
    "bus_device_id" TEXT NOT NULL,
    "camera_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" "CameraPosition" NOT NULL,
    "custom_position_label" TEXT,
    "status" "CameraStatus" NOT NULL DEFAULT 'ACTIVE',
    "manufacturer" TEXT,
    "model" TEXT,
    "stream_type" "CameraStreamType" NOT NULL DEFAULT 'NONE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cameras_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cameras_bus_device_id_key" ON "cameras"("bus_device_id");

-- CreateIndex
CREATE INDEX "cameras_bus_id_idx" ON "cameras"("bus_id");

-- CreateIndex
CREATE UNIQUE INDEX "cameras_school_id_camera_code_key" ON "cameras"("school_id", "camera_code");

-- AddForeignKey
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_bus_id_fkey" FOREIGN KEY ("bus_id") REFERENCES "buses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_bus_device_id_fkey" FOREIGN KEY ("bus_device_id") REFERENCES "bus_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security (see docs/database.md#5-row-level-security and the
-- hand-written-per-migration convention explained at length in
-- 20260829200211_init_core_schema/migration.sql). cameras is a
-- straightforward tenant-scoped table like bus_devices originally was —
-- CamerasService.resolveDeviceByCredential (used by the camera heartbeat
-- endpoint, before the caller's tenant is known) queries bus_devices, not
-- cameras, so cameras needs no platform-admin OR-clause the way
-- bus_devices did (see 20260830110000_gps_telemetry_and_device_credentials's
-- comment for that fix).
ALTER TABLE "cameras" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cameras" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cameras"
  USING ("school_id" = current_setting('app.current_school_id', true));
