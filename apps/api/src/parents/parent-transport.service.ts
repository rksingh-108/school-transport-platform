import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ParentChildTransportSummaryDto,
  ParentTransportDto,
  ParentTripStatus,
  ParentAttendanceStatus,
} from '@school-transport/shared-types';
import { PrismaService } from '../database/prisma.service';
import { GpsService } from '../gps/gps.service';

interface ResolvedTripStudent {
  studentId: string;
  currentStatus: string;
  boardedAt: Date | null;
  droppedOffAt: Date | null;
  trip: {
    id: string;
    status: string;
    scheduledStartTime: string;
    scheduledEndTime: string;
    busId: string;
    route: { direction: string };
    bus: { registrationNumber: string; fleetNumber: string | null };
  };
}

/**
 * Resolves the parent-safe transport view for one child (Phase 1 Step 8) —
 * see docs/adr/0015-parent-transport-tracking.md. Every read goes through
 * `runInTenantContext`; nothing here accepts a client-supplied schoolId, and
 * the caller (ParentSelfController/ParentTransportController) has always
 * already verified the parent-child relationship via `@RequireVerifiedChild`
 * before this service runs — this service additionally never accepts a
 * bus/trip/device id from the client at all, only a studentId, closing the
 * "arbitrary bus/trip/device" IDOR classes by construction (there is no
 * parameter to spoof).
 */
@Injectable()
export class ParentTransportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gpsService: GpsService,
  ) {}

  async getSummary(schoolId: string, studentId: string): Promise<ParentChildTransportSummaryDto> {
    const resolved = await this.resolveActiveTripStudent(schoolId, studentId);
    if (!resolved) {
      return { tripStatus: null, attendanceStatus: null, busDisplayName: null, freshness: null };
    }

    let freshness: 'LIVE' | 'STALE' | 'UNKNOWN' | null = null;
    if (resolved.trip.status === 'IN_PROGRESS') {
      const location = await this.gpsService.getLocationSnapshotForBus(schoolId, resolved.trip.busId);
      freshness = location.freshness;
    }

    return {
      tripStatus: resolved.trip.status as ParentTripStatus,
      attendanceStatus: resolved.currentStatus as ParentAttendanceStatus,
      busDisplayName: this.busDisplayName(resolved.trip.bus),
      freshness,
    };
  }

  async getTransport(schoolId: string, studentId: string): Promise<ParentTransportDto> {
    const student = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.student.findFirst({ where: { id: studentId, deletedAt: null }, select: { id: true, fullName: true, grade: true, section: true } }),
    );
    if (!student) throw new NotFoundException();

    const child = { id: student.id, fullName: student.fullName, grade: student.grade, section: student.section };
    const resolved = await this.resolveActiveTripStudent(schoolId, studentId);

    if (!resolved) {
      return { child, trip: null, bus: null, attendance: null, location: null };
    }

    const trip = {
      id: resolved.trip.id,
      status: resolved.trip.status as ParentTripStatus,
      direction: resolved.trip.route.direction as 'HOME_TO_SCHOOL' | 'SCHOOL_TO_HOME',
      scheduledStartTime: resolved.trip.scheduledStartTime,
      scheduledEndTime: resolved.trip.scheduledEndTime,
    };
    const bus = { displayName: this.busDisplayName(resolved.trip.bus) };
    const attendance = {
      status: resolved.currentStatus as ParentAttendanceStatus,
      boardedAt: resolved.boardedAt?.toISOString() ?? null,
      droppedOffAt: resolved.droppedOffAt?.toISOString() ?? null,
    };

    let location: ParentTransportDto['location'] = null;
    if (resolved.trip.status === 'IN_PROGRESS') {
      const snapshot = await this.gpsService.getLocationSnapshotForBus(schoolId, resolved.trip.busId);
      location = {
        latitude: snapshot.latitude,
        longitude: snapshot.longitude,
        speedKmh: snapshot.speedKmh,
        heading: snapshot.heading,
        lastUpdatedAt: snapshot.recordedAt,
        freshness: snapshot.freshness,
      };
    }

    return { child, trip, bus, attendance, location };
  }

  /**
   * "Active trip resolution" (item 10 of the spec): an IN_PROGRESS trip
   * always wins regardless of date (a trip running late past midnight is
   * still the relevant one); otherwise, among today's trips for this
   * student (school-timezone "today"), the soonest-starting SCHEDULED/READY
   * one; otherwise the most-recently-ended COMPLETED/CANCELLED/NO_SHOW one
   * so a parent still sees "dropped off"/"cancelled" for a while after the
   * trip ends rather than suddenly seeing nothing. At most two small,
   * indexed queries — bounded by one child, not by school size, so this is
   * not the N+1 pattern the "avoid N+1" requirement is about (that concern
   * is about `getMyChildrenSummaries` below, handled by running this once
   * per verified child in parallel, never once per student in the school).
   */
  private async resolveActiveTripStudent(schoolId: string, studentId: string): Promise<ResolvedTripStudent | null> {
    const include = {
      trip: {
        select: {
          id: true,
          status: true,
          scheduledStartTime: true,
          scheduledEndTime: true,
          endedAt: true,
          busId: true,
          route: { select: { direction: true } },
          bus: { select: { registrationNumber: true, fleetNumber: true } },
        },
      },
    } as const;

    const inProgress = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.tripStudent.findFirst({
        where: { studentId, membershipStatus: { not: 'REMOVED' }, trip: { status: 'IN_PROGRESS' } },
        include,
        orderBy: { trip: { startedAt: 'desc' } },
      }),
    );
    if (inProgress) return inProgress as ResolvedTripStudent;

    const school = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } }),
    );
    const todayStr = this.todayInTimezone(school.timezone);

    const todays = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.tripStudent.findMany({
        where: { studentId, membershipStatus: { not: 'REMOVED' }, trip: { serviceDate: new Date(todayStr) } },
        include,
      }),
    );

    const upcoming = todays
      .filter((r) => r.trip.status === 'SCHEDULED' || r.trip.status === 'READY')
      .sort((a, b) => a.trip.scheduledStartTime.localeCompare(b.trip.scheduledStartTime))[0];
    if (upcoming) return upcoming as ResolvedTripStudent;

    const past = todays
      .filter((r) => r.trip.status === 'COMPLETED' || r.trip.status === 'CANCELLED' || r.trip.status === 'NO_SHOW')
      .sort((a, b) => (b.trip.endedAt?.getTime() ?? 0) - (a.trip.endedAt?.getTime() ?? 0))[0];
    return (past as ResolvedTripStudent) ?? null;
  }

  private todayInTimezone(timezone: string): string {
    // en-CA formats as YYYY-MM-DD, matching the `serviceDate` DATE column's
    // storage convention used throughout the trips domain.
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  }

  private busDisplayName(bus: { registrationNumber: string; fleetNumber: string | null }): string {
    return bus.fleetNumber ? `Bus ${bus.fleetNumber}` : bus.registrationNumber;
  }
}
