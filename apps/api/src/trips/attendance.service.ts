import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AttendanceEventDto, TripStudentDto } from '@school-transport/shared-types';
import type { RecordAttendanceInput, CorrectAttendanceInput } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';

const tripStudentInclude = {
  student: { select: { fullName: true, admissionNumber: true } },
  pickupTripStop: { select: { name: true } },
  dropoffTripStop: { select: { name: true } },
} as const;

type TripStudentRow = Prisma.TripStudentGetPayload<{ include: typeof tripStudentInclude }>;

const eventInclude = {
  tripStop: { select: { name: true } },
  recorder: { select: { fullName: true } },
} as const;

type EventRow = Prisma.AttendanceEventGetPayload<{ include: typeof eventInclude }>;

/** ACTIVE trip statuses where boarding/drop-off/absence can normally be recorded — see docs/adr/0013. */
const OPERATIONAL_STATUSES = new Set(['IN_PROGRESS']);
const ABSENCE_ALLOWED_STATUSES = new Set(['SCHEDULED', 'READY', 'IN_PROGRESS']);

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly domainEvents: DomainEventsService,
  ) {}

  /** BUS_ATTENDANT holds `attendance.manage` scoped to "own trip only" (docs/security.md §5.5) — resolved by profile, not role name, same pattern as TripsService's driver scoping. */
  private async assertCanRecordAttendance(
    tx: Prisma.TransactionClient,
    principal: AuthenticatedPrincipal,
    trip: { attendantId: string | null },
  ): Promise<void> {
    const attendant = await tx.attendant.findUnique({ where: { userId: principal.id } });
    if (!attendant) return; // not an attendant profile at all — e.g. TRANSPORT_MANAGER, unscoped
    if (attendant.id !== trip.attendantId) {
      throw new ForbiddenException('Only the trip\'s assigned attendant or attendance management staff can do this.');
    }
  }

  private async loadTripAndStudent(tx: Prisma.TransactionClient, tripId: string, tripStudentId: string) {
    const trip = await tx.trip.findFirst({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('No such trip.');
    const tripStudent = await tx.tripStudent.findFirst({ where: { id: tripStudentId, tripId } });
    if (!tripStudent) throw new NotFoundException('No such manifest entry on this trip.');
    if (tripStudent.membershipStatus === 'REMOVED') {
      throw new BadRequestException('This student has been removed from the manifest.');
    }
    return { trip, tripStudent };
  }

  async board(
    principal: AuthenticatedPrincipal,
    tripId: string,
    tripStudentId: string,
    input: RecordAttendanceInput,
    meta: RequestMeta,
  ): Promise<TripStudentDto> {
    const result = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const { trip, tripStudent } = await this.loadTripAndStudent(tx, tripId, tripStudentId);
      await this.assertCanRecordAttendance(tx, principal, trip);
      if (!OPERATIONAL_STATUSES.has(trip.status)) {
        throw new BadRequestException('Boarding can only be recorded while the trip is in progress.');
      }
      if (tripStudent.currentStatus === 'BOARDED' || tripStudent.currentStatus === 'DROPPED_OFF') {
        throw new BadRequestException('This student has already boarded.');
      }

      const occurredAt = new Date();
      const event = await tx.attendanceEvent.create({
        data: {
          schoolId: principal.schoolId,
          tripId,
          tripStudentId,
          tripStopId: tripStudent.pickupTripStopId,
          eventType: 'BOARDING_CONFIRMED',
          recordedBy: principal.id,
          occurredAt,
          notes: input.notes,
        },
      });
      const updated = await tx.tripStudent.update({
        where: { id: tripStudentId },
        data: { currentStatus: 'BOARDED', boardedAt: occurredAt },
        include: tripStudentInclude,
      });
      return { updated, eventId: event.id };
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'STUDENT_BOARDED',
      subjectType: 'AttendanceEvent',
      subjectId: result.eventId,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { tripId, tripStudentId },
    });

    // Published only from a normal board — never from correct() — so a
    // correction can never resend a duplicate "your child boarded"
    // notification. See NotificationsService and docs/adr/0016.
    this.domainEvents.publish({
      type: 'CHILD_BOARDED',
      schoolId: principal.schoolId,
      tripId,
      studentId: result.updated.studentId,
      attendanceEventId: result.eventId,
    });

    return this.toTripStudentDto(result.updated);
  }

  async dropOff(
    principal: AuthenticatedPrincipal,
    tripId: string,
    tripStudentId: string,
    input: RecordAttendanceInput,
    meta: RequestMeta,
  ): Promise<TripStudentDto> {
    const result = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const { trip, tripStudent } = await this.loadTripAndStudent(tx, tripId, tripStudentId);
      await this.assertCanRecordAttendance(tx, principal, trip);
      if (!OPERATIONAL_STATUSES.has(trip.status)) {
        throw new BadRequestException('Drop-off can only be recorded while the trip is in progress.');
      }
      if (tripStudent.currentStatus === 'DROPPED_OFF') {
        throw new BadRequestException('This student has already been dropped off.');
      }
      if (tripStudent.currentStatus !== 'BOARDED') {
        throw new BadRequestException('This student must be boarded before they can be dropped off.');
      }

      const occurredAt = new Date();
      const event = await tx.attendanceEvent.create({
        data: {
          schoolId: principal.schoolId,
          tripId,
          tripStudentId,
          tripStopId: tripStudent.dropoffTripStopId,
          eventType: 'DROPPED_OFF',
          recordedBy: principal.id,
          occurredAt,
          notes: input.notes,
        },
      });
      const updated = await tx.tripStudent.update({
        where: { id: tripStudentId },
        data: { currentStatus: 'DROPPED_OFF', droppedOffAt: occurredAt },
        include: tripStudentInclude,
      });
      return { updated, eventId: event.id };
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'STUDENT_DROPPED_OFF',
      subjectType: 'AttendanceEvent',
      subjectId: result.eventId,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { tripId, tripStudentId },
    });

    this.domainEvents.publish({
      type: 'CHILD_DROPPED_OFF',
      schoolId: principal.schoolId,
      tripId,
      studentId: result.updated.studentId,
      attendanceEventId: result.eventId,
    });

    return this.toTripStudentDto(result.updated);
  }

  /** Explicit only — never inferred from "hasn't boarded yet". See docs/adr/0013. */
  async markAbsent(
    principal: AuthenticatedPrincipal,
    tripId: string,
    tripStudentId: string,
    input: RecordAttendanceInput,
    meta: RequestMeta,
  ): Promise<TripStudentDto> {
    const result = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const { trip, tripStudent } = await this.loadTripAndStudent(tx, tripId, tripStudentId);
      await this.assertCanRecordAttendance(tx, principal, trip);
      if (!ABSENCE_ALLOWED_STATUSES.has(trip.status)) {
        throw new BadRequestException('Absence can only be recorded before or during the trip.');
      }
      if (tripStudent.currentStatus === 'ABSENT') {
        throw new BadRequestException('This student is already marked absent.');
      }
      if (tripStudent.currentStatus === 'BOARDED' || tripStudent.currentStatus === 'DROPPED_OFF') {
        throw new BadRequestException('This student has already boarded and cannot be marked absent — use a correction instead.');
      }

      const occurredAt = new Date();
      const event = await tx.attendanceEvent.create({
        data: {
          schoolId: principal.schoolId,
          tripId,
          tripStudentId,
          tripStopId: null,
          eventType: 'MARKED_ABSENT',
          recordedBy: principal.id,
          occurredAt,
          notes: input.notes,
        },
      });
      const updated = await tx.tripStudent.update({
        where: { id: tripStudentId },
        data: { currentStatus: 'ABSENT' },
        include: tripStudentInclude,
      });
      return { updated, eventId: event.id };
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'STUDENT_MARKED_ABSENT',
      subjectType: 'AttendanceEvent',
      subjectId: result.eventId,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { tripId, tripStudentId },
    });

    return this.toTripStudentDto(result.updated);
  }

  /**
   * A correction is a NEW immutable event (`correctsEventId` pointing at
   * the one it supersedes), never an update to the original — see
   * docs/adr/0013-attendance-event-model.md. Allowed regardless of trip
   * status (fixing a past mistake doesn't depend on the trip still being
   * in progress) — the operational-state gates above only apply to normal
   * recording.
   */
  async correct(
    principal: AuthenticatedPrincipal,
    tripId: string,
    tripStudentId: string,
    eventId: string,
    input: CorrectAttendanceInput,
    meta: RequestMeta,
  ): Promise<TripStudentDto> {
    const result = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const { trip, tripStudent } = await this.loadTripAndStudent(tx, tripId, tripStudentId);
      await this.assertCanRecordAttendance(tx, principal, trip);

      const original = await tx.attendanceEvent.findFirst({ where: { id: eventId, tripStudentId } });
      if (!original) throw new NotFoundException('No such attendance event on this manifest entry.');

      const tripStopId =
        input.eventType === 'BOARDING_CONFIRMED'
          ? tripStudent.pickupTripStopId
          : input.eventType === 'DROPPED_OFF'
            ? tripStudent.dropoffTripStopId
            : null;
      const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();

      const event = await tx.attendanceEvent.create({
        data: {
          schoolId: principal.schoolId,
          tripId,
          tripStudentId,
          tripStopId,
          eventType: input.eventType,
          recordedBy: principal.id,
          occurredAt,
          correctsEventId: eventId,
          notes: input.notes,
        },
      });

      const newStatus: 'BOARDED' | 'DROPPED_OFF' | 'ABSENT' =
        input.eventType === 'BOARDING_CONFIRMED' ? 'BOARDED' : input.eventType === 'DROPPED_OFF' ? 'DROPPED_OFF' : 'ABSENT';
      const updated = await tx.tripStudent.update({
        where: { id: tripStudentId },
        data: {
          currentStatus: newStatus,
          boardedAt: newStatus === 'BOARDED' ? occurredAt : newStatus === 'DROPPED_OFF' ? tripStudent.boardedAt : null,
          droppedOffAt: newStatus === 'DROPPED_OFF' ? occurredAt : null,
        },
        include: tripStudentInclude,
      });
      return { updated, eventId: event.id };
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'ATTENDANCE_CORRECTED',
      subjectType: 'AttendanceEvent',
      subjectId: result.eventId,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { tripId, tripStudentId, correctsEventId: eventId, eventType: input.eventType },
    });

    return this.toTripStudentDto(result.updated);
  }

  /** Full event history for one manifest entry, oldest first, corrections included — the audit/correction trail. */
  async history(principal: AuthenticatedPrincipal, tripId: string, tripStudentId: string): Promise<AttendanceEventDto[]> {
    const events = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const tripStudent = await tx.tripStudent.findFirst({ where: { id: tripStudentId, tripId } });
      if (!tripStudent) throw new NotFoundException('No such manifest entry on this trip.');
      return tx.attendanceEvent.findMany({ where: { tripStudentId }, include: eventInclude, orderBy: { createdAt: 'asc' } });
    });
    return events.map((e) => this.toEventDto(e));
  }

  private toTripStudentDto(row: TripStudentRow): TripStudentDto {
    return {
      id: row.id,
      tripId: row.tripId,
      studentId: row.studentId,
      studentFullName: row.student.fullName,
      studentAdmissionNumber: row.student.admissionNumber,
      pickupTripStopId: row.pickupTripStopId,
      pickupStopName: row.pickupTripStop?.name ?? null,
      dropoffTripStopId: row.dropoffTripStopId,
      dropoffStopName: row.dropoffTripStop?.name ?? null,
      membershipStatus: row.membershipStatus as TripStudentDto['membershipStatus'],
      notes: row.notes,
      currentStatus: row.currentStatus as TripStudentDto['currentStatus'],
      boardedAt: row.boardedAt?.toISOString() ?? null,
      droppedOffAt: row.droppedOffAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toEventDto(event: EventRow): AttendanceEventDto {
    return {
      id: event.id,
      tripId: event.tripId,
      tripStudentId: event.tripStudentId,
      eventType: event.eventType as AttendanceEventDto['eventType'],
      source: event.source as AttendanceEventDto['source'],
      tripStopId: event.tripStopId,
      tripStopName: event.tripStop?.name ?? null,
      occurredAt: event.occurredAt.toISOString(),
      recordedByName: event.recorder?.fullName ?? null,
      correctsEventId: event.correctsEventId,
      notes: event.notes,
      createdAt: event.createdAt.toISOString(),
    };
  }
}
