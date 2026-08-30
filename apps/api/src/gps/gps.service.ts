import { BadRequestException, ForbiddenException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { BusLocationDto, BusLocationUpdatedEvent, GpsPointDto } from '@school-transport/shared-types';
import type { GpsHistoryQuery, GpsTelemetryInput } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TokenService } from '../auth/services/token.service';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { Env } from '../config/env.schema';
import { GpsGateway } from './gps.gateway';
import type { AuthenticatedDevice } from './types/device-principal';

type GpsPointRow = {
  id: bigint;
  busId: string;
  tripId: string | null;
  latitude: number;
  longitude: number;
  speedKmh: Prisma.Decimal | null;
  heading: Prisma.Decimal | null;
  accuracyM: Prisma.Decimal | null;
  deviceTime: Date;
  receivedAt: Date;
};

/** What's cached in Redis for "current location" — a small, fast-read projection, not the full historical row. */
interface CurrentLocationSnapshot {
  tripId: string | null;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  heading: number | null;
  accuracyM: number | null;
  deviceTime: string;
  receivedAt: string;
}

/** Redis-side hygiene only — freshness itself is always computed dynamically from `deviceTime` vs. now, never from this TTL. Keeps decommissioned buses' keys from lingering forever. */
const CURRENT_LOCATION_TTL_SECONDS = 60 * 60 * 24 * 30;

type GpsScope = { scope: 'ALL' } | { scope: 'BUS'; busId: string | null };

/**
 * GPS telemetry ingestion, current-location state, history, and realtime
 * fan-out (Phase 1 Step 7). See
 * docs/adr/0014-gps-telemetry-and-realtime-tracking.md for the full design
 * (raw-vs-current separation, monotonic timestamp rule, dedup strategy,
 * "own bus only" scoping for DRIVER/BUS_ATTENDANT).
 */
@Injectable()
export class GpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokenService: TokenService,
    private readonly config: ConfigService<Env, true>,
    @Inject(forwardRef(() => GpsGateway)) private readonly gateway: GpsGateway,
  ) {}

  // ---------------------------------------------------------------------
  // Device authentication
  // ---------------------------------------------------------------------

  /** Used by DeviceAuthGuard. Resolves a device's identity purely from its bearer credential — never from any client-supplied id. */
  async resolveDeviceByCredential(rawToken: string): Promise<AuthenticatedDevice | null> {
    const hash = this.tokenService.hashOpaqueToken(rawToken);
    const device = await this.prisma.runAsPlatformAdmin((tx) =>
      tx.busDevice.findFirst({
        where: { credentialHash: hash, deviceType: 'GPS_TRACKER', status: 'ACTIVE' },
        select: { id: true, busId: true, schoolId: true },
      }),
    );
    return device ? { id: device.id, busId: device.busId, schoolId: device.schoolId } : null;
  }

  // ---------------------------------------------------------------------
  // Ingestion
  // ---------------------------------------------------------------------

  async ingest(device: AuthenticatedDevice, input: GpsTelemetryInput): Promise<{ deduplicated: boolean }> {
    const recordedAt = new Date(input.recordedAt);
    const now = new Date();
    this.assertTimestampSane(recordedAt, now);

    const inserted = await this.prisma.runInTenantContext(device.schoolId, async (tx) => {
      // Server-derived — a device can never claim an arbitrary trip. At
      // most one trip per bus is ever IN_PROGRESS (TripsService's conflict
      // detection, Phase 1 Step 5), so this is unambiguous.
      const activeTrip = await tx.trip.findFirst({
        where: { busId: device.busId, status: 'IN_PROGRESS' },
        select: { id: true },
      });

      try {
        return await tx.gpsPoint.create({
          data: {
            schoolId: device.schoolId,
            busId: device.busId,
            deviceId: device.id,
            tripId: activeTrip?.id ?? null,
            latitude: input.latitude,
            longitude: input.longitude,
            speedKmh: input.speedKmh,
            heading: input.heading,
            accuracyM: input.accuracyM,
            deviceTime: recordedAt,
          },
        });
      } catch (err) {
        // Retry-safe dedup: the same device resending the same fix
        // (identical deviceTime) is a no-op, not an error — see the ADR.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return null;
        }
        throw err;
      }
    });

    if (!inserted) return { deduplicated: true };

    await this.prisma.runInTenantContext(device.schoolId, (tx) =>
      tx.busDevice.update({ where: { id: device.id }, data: { lastSeenAt: now } }),
    );

    await this.maybeAdvanceCurrentLocation(device.schoolId, device.busId, {
      tripId: inserted.tripId,
      latitude: inserted.latitude,
      longitude: inserted.longitude,
      speedKmh: inserted.speedKmh ? Number(inserted.speedKmh) : null,
      heading: inserted.heading ? Number(inserted.heading) : null,
      accuracyM: inserted.accuracyM ? Number(inserted.accuracyM) : null,
      deviceTime: recordedAt,
      receivedAt: inserted.receivedAt,
    });

    return { deduplicated: false };
  }

  /** Dev/test-only: pushes one synthetic fix through the exact same ingest path, as if it came from the bus's own GPS_TRACKER device. Never reachable in production — see GpsSimulatorController. */
  async simulateIngest(principal: AuthenticatedPrincipal, busId: string, input: GpsTelemetryInput): Promise<{ deduplicated: boolean }> {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new ForbiddenException('The GPS simulator is not available in production.');
    }
    const device = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.busDevice.findFirst({
        where: { busId, deviceType: 'GPS_TRACKER' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, busId: true, schoolId: true },
      }),
    );
    if (!device) throw new NotFoundException('This bus has no GPS_TRACKER device to simulate telemetry from.');
    return this.ingest(device, input);
  }

  private assertTimestampSane(recordedAt: Date, now: Date): void {
    if (Number.isNaN(recordedAt.getTime())) {
      throw new BadRequestException('Invalid recordedAt timestamp.');
    }
    const futureSkewSeconds = (recordedAt.getTime() - now.getTime()) / 1000;
    if (futureSkewSeconds > this.config.get('GPS_MAX_FUTURE_SKEW_SECONDS', { infer: true })) {
      throw new BadRequestException('recordedAt is too far in the future.');
    }
    const pastAgeDays = (now.getTime() - recordedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (pastAgeDays > this.config.get('GPS_MAX_PAST_AGE_DAYS', { infer: true })) {
      throw new BadRequestException('recordedAt is too far in the past.');
    }
  }

  /** Monotonic-forward-only rule (item 9): an older or equal fix never overwrites a newer current location, even though it's still persisted to Postgres above. */
  private async maybeAdvanceCurrentLocation(
    schoolId: string,
    busId: string,
    candidate: Omit<CurrentLocationSnapshot, 'deviceTime' | 'receivedAt'> & { deviceTime: Date; receivedAt: Date },
  ): Promise<void> {
    const key = this.redisKey(schoolId, busId);
    const existingRaw = await this.redis.client.get(key);
    if (existingRaw) {
      const existing = JSON.parse(existingRaw) as CurrentLocationSnapshot;
      if (new Date(existing.deviceTime).getTime() >= candidate.deviceTime.getTime()) {
        return;
      }
    }

    const snapshot: CurrentLocationSnapshot = {
      tripId: candidate.tripId,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      speedKmh: candidate.speedKmh,
      heading: candidate.heading,
      accuracyM: candidate.accuracyM,
      deviceTime: candidate.deviceTime.toISOString(),
      receivedAt: candidate.receivedAt.toISOString(),
    };
    await this.redis.client.set(key, JSON.stringify(snapshot), 'EX', CURRENT_LOCATION_TTL_SECONDS);

    const event: BusLocationUpdatedEvent = {
      busId,
      tripId: snapshot.tripId,
      latitude: snapshot.latitude,
      longitude: snapshot.longitude,
      speedKmh: snapshot.speedKmh,
      heading: snapshot.heading,
      accuracyM: snapshot.accuracyM,
      recordedAt: snapshot.deviceTime,
      receivedAt: snapshot.receivedAt,
      freshness: this.computeFreshness(candidate.deviceTime, new Date()),
    };
    this.gateway.emitLocationUpdate(schoolId, busId, event);
  }

  // ---------------------------------------------------------------------
  // Staff-facing reads
  // ---------------------------------------------------------------------

  async getCurrentLocation(principal: AuthenticatedPrincipal, busId: string): Promise<BusLocationDto> {
    await this.assertBusAccessible(principal, busId);
    return this.readCurrentLocation(principal.schoolId, busId);
  }

  async getFleetLocations(principal: AuthenticatedPrincipal): Promise<BusLocationDto[]> {
    const scope = await this.resolveGpsScope(principal);
    const busIds = await this.busIdsInScope(principal, scope);
    return Promise.all(busIds.map((busId) => this.readCurrentLocation(principal.schoolId, busId)));
  }

  async getBusHistory(principal: AuthenticatedPrincipal, busId: string, query: GpsHistoryQuery): Promise<GpsPointDto[]> {
    await this.assertBusAccessible(principal, busId);
    const points = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.gpsPoint.findMany({
        where: { busId, deviceTime: this.rangeFilter(query) },
        orderBy: { deviceTime: 'desc' },
        take: query.limit,
      }),
    );
    return points.map((p) => this.toPointDto(p));
  }

  async getTripHistory(principal: AuthenticatedPrincipal, tripId: string, query: GpsHistoryQuery): Promise<GpsPointDto[]> {
    const trip = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.trip.findFirst({ where: { id: tripId }, select: { busId: true } }),
    );
    if (!trip) throw new NotFoundException('No such trip.');
    await this.assertBusAccessible(principal, trip.busId);

    const points = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.gpsPoint.findMany({
        where: { tripId, deviceTime: this.rangeFilter(query) },
        orderBy: { deviceTime: 'desc' },
        take: query.limit,
      }),
    );
    return points.map((p) => this.toPointDto(p));
  }

  private rangeFilter(query: GpsHistoryQuery): Prisma.DateTimeFilter | undefined {
    if (!query.from && !query.to) return undefined;
    return {
      gte: query.from ? new Date(query.from) : undefined,
      lte: query.to ? new Date(query.to) : undefined,
    };
  }

  /**
   * "own bus only" for DRIVER/BUS_ATTENDANT (docs/security.md §2.3's
   * gps.read row) is resolved the same profile-based way as
   * AttendanceService's own-trip scoping: does the caller have a
   * Driver/Attendant profile at all, and if so, what bus is their own
   * currently in-progress trip on. A profile-holder with no current trip is
   * scoped to nothing (safe default), not "every bus." Anyone without
   * either profile (SCHOOL_ADMIN, TRANSPORT_ADMIN, TRANSPORT_MANAGER,
   * PRINCIPAL, SECURITY) is unscoped, matching the matrix's "✓" for those
   * roles. Exposed (not just private) so GpsGateway can reuse it at
   * WebSocket connect time instead of duplicating the query.
   */
  async resolveGpsScope(principal: AuthenticatedPrincipal): Promise<GpsScope> {
    return this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const driver = await tx.driver.findUnique({ where: { userId: principal.id }, select: { id: true } });
      if (driver) {
        const trip = await tx.trip.findFirst({
          where: { driverId: driver.id, status: 'IN_PROGRESS' },
          select: { busId: true },
        });
        return { scope: 'BUS', busId: trip?.busId ?? null };
      }

      const attendant = await tx.attendant.findUnique({ where: { userId: principal.id }, select: { id: true } });
      if (attendant) {
        const trip = await tx.trip.findFirst({
          where: { attendantId: attendant.id, status: 'IN_PROGRESS' },
          select: { busId: true },
        });
        return { scope: 'BUS', busId: trip?.busId ?? null };
      }

      return { scope: 'ALL' };
    });
  }

  private async busIdsInScope(principal: AuthenticatedPrincipal, scope: GpsScope): Promise<string[]> {
    if (scope.scope === 'BUS') return scope.busId ? [scope.busId] : [];
    const buses = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.bus.findMany({ where: { deletedAt: null }, select: { id: true } }),
    );
    return buses.map((b) => b.id);
  }

  private async assertBusAccessible(principal: AuthenticatedPrincipal, busId: string): Promise<void> {
    const bus = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.bus.findFirst({ where: { id: busId, deletedAt: null }, select: { id: true } }),
    );
    if (!bus) throw new NotFoundException('No such bus.');

    const scope = await this.resolveGpsScope(principal);
    if (scope.scope === 'BUS' && scope.busId !== busId) {
      throw new ForbiddenException('You can only view your own currently assigned bus.');
    }
  }

  private async readCurrentLocation(schoolId: string, busId: string): Promise<BusLocationDto> {
    const bus = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.bus.findFirst({ where: { id: busId }, select: { registrationNumber: true, fleetNumber: true } }),
    );
    if (!bus) throw new NotFoundException('No such bus.');

    const key = this.redisKey(schoolId, busId);
    let snapshot: CurrentLocationSnapshot | null = null;
    const raw = await this.redis.client.get(key);
    if (raw) {
      snapshot = JSON.parse(raw) as CurrentLocationSnapshot;
    } else {
      // Cold-start fallback — Postgres remains the durable source of truth.
      const latest = await this.prisma.runInTenantContext(schoolId, (tx) =>
        tx.gpsPoint.findFirst({ where: { busId }, orderBy: { deviceTime: 'desc' } }),
      );
      if (latest) {
        snapshot = {
          tripId: latest.tripId,
          latitude: latest.latitude,
          longitude: latest.longitude,
          speedKmh: latest.speedKmh ? Number(latest.speedKmh) : null,
          heading: latest.heading ? Number(latest.heading) : null,
          accuracyM: latest.accuracyM ? Number(latest.accuracyM) : null,
          deviceTime: latest.deviceTime.toISOString(),
          receivedAt: latest.receivedAt.toISOString(),
        };
        await this.redis.client.set(key, JSON.stringify(snapshot), 'EX', CURRENT_LOCATION_TTL_SECONDS);
      }
    }

    const device = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.busDevice.findFirst({
        where: { busId, deviceType: 'GPS_TRACKER' },
        orderBy: { lastSeenAt: 'desc' },
        select: { lastSeenAt: true },
      }),
    );
    const deviceLastSeenAt = device?.lastSeenAt?.toISOString() ?? null;

    if (!snapshot) {
      return {
        busId,
        busRegistrationNumber: bus.registrationNumber,
        busFleetNumber: bus.fleetNumber,
        tripId: null,
        latitude: null,
        longitude: null,
        speedKmh: null,
        heading: null,
        accuracyM: null,
        recordedAt: null,
        receivedAt: null,
        freshness: 'UNKNOWN',
        deviceLastSeenAt,
      };
    }

    return {
      busId,
      busRegistrationNumber: bus.registrationNumber,
      busFleetNumber: bus.fleetNumber,
      tripId: snapshot.tripId,
      latitude: snapshot.latitude,
      longitude: snapshot.longitude,
      speedKmh: snapshot.speedKmh,
      heading: snapshot.heading,
      accuracyM: snapshot.accuracyM,
      recordedAt: snapshot.deviceTime,
      receivedAt: snapshot.receivedAt,
      freshness: this.computeFreshness(new Date(snapshot.deviceTime), new Date()),
      deviceLastSeenAt,
    };
  }

  private computeFreshness(deviceTime: Date | null, now: Date): 'LIVE' | 'STALE' | 'UNKNOWN' {
    if (!deviceTime) return 'UNKNOWN';
    const ageSeconds = (now.getTime() - deviceTime.getTime()) / 1000;
    if (ageSeconds <= this.config.get('GPS_LIVE_THRESHOLD_SECONDS', { infer: true })) return 'LIVE';
    if (ageSeconds <= this.config.get('GPS_STALE_THRESHOLD_SECONDS', { infer: true })) return 'STALE';
    return 'UNKNOWN';
  }

  private redisKey(schoolId: string, busId: string): string {
    return `school:${schoolId}:bus:${busId}:location`;
  }

  private toPointDto(p: GpsPointRow): GpsPointDto {
    return {
      id: p.id.toString(),
      busId: p.busId,
      tripId: p.tripId,
      latitude: p.latitude,
      longitude: p.longitude,
      speedKmh: p.speedKmh ? Number(p.speedKmh) : null,
      heading: p.heading ? Number(p.heading) : null,
      accuracyM: p.accuracyM ? Number(p.accuracyM) : null,
      recordedAt: p.deviceTime.toISOString(),
      receivedAt: p.receivedAt.toISOString(),
    };
  }
}
