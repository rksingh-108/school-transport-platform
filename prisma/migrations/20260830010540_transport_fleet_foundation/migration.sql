-- AlterEnum
ALTER TYPE "BusStatus" ADD VALUE 'INACTIVE';

-- AlterEnum
-- Renamed from the Phase 0 placeholder values (GPS/CAMERA/EDGE_AI_BOX); no
-- rows existed under the old names (see prisma/schema.prisma's DeviceType
-- comment), so this is a same-migration rename, not a data migration.
BEGIN;
CREATE TYPE "DeviceType_new" AS ENUM ('GPS_TRACKER', 'EDGE_COMPUTER', 'NETWORK_GATEWAY');
ALTER TABLE "bus_devices" ALTER COLUMN "device_type" TYPE "DeviceType_new" USING ("device_type"::text::"DeviceType_new");
ALTER TYPE "DeviceType" RENAME TO "DeviceType_old";
ALTER TYPE "DeviceType_new" RENAME TO "DeviceType";
DROP TYPE "DeviceType_old";
COMMIT;

-- AlterTable
ALTER TABLE "bus_devices" ADD COLUMN     "firmware_version" TEXT,
ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "buses" ADD COLUMN     "fleet_number" TEXT,
ADD COLUMN     "manufacture_year" INTEGER,
ADD COLUMN     "notes" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "buses_school_id_fleet_number_key" ON "buses"("school_id", "fleet_number");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_school_id_license_number_key" ON "drivers"("school_id", "license_number");
