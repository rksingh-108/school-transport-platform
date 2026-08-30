-- Phase 1 Step 7: GPS telemetry + device credentials.
-- Additive only — no data migration needed (bus_devices.credential_hash/
-- credential_set_at start NULL for every existing device; gps_points has
-- zero rows in any environment this migrates). RLS for gps_points was
-- already enabled by the generic tenant_isolation loop in
-- 20260829200211_init_core_schema — no RLS change needed here.

-- AlterTable
ALTER TABLE "bus_devices" ADD COLUMN     "credential_hash" TEXT,
ADD COLUMN     "credential_set_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "gps_points" ADD COLUMN     "accuracy_m" DECIMAL(6,2);

-- CreateIndex
CREATE UNIQUE INDEX "bus_devices_credential_hash_key" ON "bus_devices"("credential_hash");

-- CreateIndex
CREATE INDEX "gps_points_school_id_device_time_idx" ON "gps_points"("school_id", "device_time" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "gps_points_device_id_device_time_key" ON "gps_points"("device_id", "device_time");

-- Per docs/adr/0010-credential-resolution-rls-bypass.md's rule ("every table
-- a call site passes to runAsPlatformAdmin must carry this clause"):
-- GpsService.resolveDeviceByCredential looks up a BusDevice by its
-- credential hash BEFORE the caller's tenant is known (that's the entire
-- point — the device's identity is what tells us its schoolId), the same
-- shape as staff/parent login resolving an identifier across tenants.
-- bus_devices was created in the initial migration with only the plain
-- tenant-scoped policy (Phase 1 Step 3 never needed a pre-tenant lookup
-- against it), so it needs the same OR-clause already added to
-- users/parents/refresh_tokens/password_reset_tokens/invitations.
DROP POLICY tenant_isolation ON "bus_devices";
CREATE POLICY tenant_isolation ON "bus_devices"
  USING (
    "school_id" = current_setting('app.current_school_id', true)
    OR coalesce(current_setting('app.is_platform_admin', true), 'false') = 'true'
  );
