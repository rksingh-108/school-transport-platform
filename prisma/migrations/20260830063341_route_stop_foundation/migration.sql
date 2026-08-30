-- CreateEnum
CREATE TYPE "RouteDirection" AS ENUM ('HOME_TO_SCHOOL', 'SCHOOL_TO_HOME');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StopMode" AS ENUM ('PICKUP', 'DROPOFF', 'BOTH');

-- CreateEnum
CREATE TYPE "RouteStopStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- DropForeignKey
-- Phase 0's `routes.default_bus_id` modeled a permanent route<->bus binding
-- that Phase 1 Step 4's design explicitly rules out (see schema.prisma's
-- Route comment) — the future Trip model is the one place bus/driver/
-- attendant assignment happens.
ALTER TABLE "routes" DROP CONSTRAINT "routes_default_bus_id_fkey";

-- AlterTable
-- `updated_at` is backfilled via its own DEFAULT for any pre-existing rows,
-- then the default is dropped so new rows always get an explicit value from
-- Prisma's `@updatedAt`, matching schema.prisma (which declares no
-- column-level default).
ALTER TABLE "route_stops" ADD COLUMN     "address" TEXT,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "mode" "StopMode" NOT NULL DEFAULT 'BOTH',
ADD COLUMN     "status" "RouteStopStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "route_stops" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
-- `direction` is backfilled to HOME_TO_SCHOOL for any pre-existing rows
-- (Phase 0's only seeded route was in fact a morning/home-to-school route),
-- then the default is dropped so every future route must specify one
-- explicitly, matching schema.prisma.
ALTER TABLE "routes" DROP COLUMN "default_bus_id",
ADD COLUMN     "code" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "direction" "RouteDirection" NOT NULL DEFAULT 'HOME_TO_SCHOOL',
DROP COLUMN "status",
ADD COLUMN     "status" "RouteStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "routes" ALTER COLUMN "direction" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "routes_school_id_code_key" ON "routes"("school_id", "code");
