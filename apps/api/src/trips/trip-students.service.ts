import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TripStudentDto } from '@school-transport/shared-types';
import type { CreateTripStudentInput, UpdateTripStudentInput } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';

const include = {
  student: { select: { fullName: true, admissionNumber: true } },
  pickupTripStop: { select: { name: true } },
  dropoffTripStop: { select: { name: true } },
} as const;

type TripStudentRow = {
  id: string;
  tripId: string;
  studentId: string;
  pickupTripStopId: string | null;
  dropoffTripStopId: string | null;
  membershipStatus: string;
  notes: string | null;
  currentStatus: string;
  boardedAt: Date | null;
  droppedOffAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  student: { fullName: string; admissionNumber: string };
  pickupTripStop: { name: string } | null;
  dropoffTripStop: { name: string } | null;
};

@Injectable()
export class TripStudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private async assertTripInTenant(schoolId: string, tripId: string): Promise<void> {
    const trip = await this.prisma.runInTenantContext(schoolId, (tx) => tx.trip.findFirst({ where: { id: tripId } }));
    if (!trip) throw new NotFoundException('No such trip.');
  }

  async list(principal: AuthenticatedPrincipal, tripId: string): Promise<TripStudentDto[]> {
    await this.assertTripInTenant(principal.schoolId, tripId);
    const rows = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.tripStudent.findMany({ where: { tripId, membershipStatus: { not: 'REMOVED' } }, include, orderBy: { createdAt: 'asc' } }),
    );
    return rows.map((r) => this.toDto(r));
  }

  async create(
    principal: AuthenticatedPrincipal,
    tripId: string,
    input: CreateTripStudentInput,
    meta: RequestMeta,
  ): Promise<TripStudentDto> {
    await this.assertTripInTenant(principal.schoolId, tripId);

    const row = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: input.studentId, deletedAt: null } });
      if (!student) throw new NotFoundException('No such student.');
      if (student.status !== 'ACTIVE') throw new BadRequestException('This student is not active.');

      for (const stopId of [input.pickupTripStopId, input.dropoffTripStopId]) {
        if (!stopId) continue;
        const stop = await tx.tripStop.findFirst({ where: { id: stopId, tripId } });
        if (!stop) throw new BadRequestException('The selected stop does not belong to this trip.');
      }

      const existing = await tx.tripStudent.findUnique({ where: { tripId_studentId: { tripId, studentId: input.studentId } } });
      if (existing && existing.membershipStatus !== 'REMOVED') {
        throw new BadRequestException('This student is already on the manifest for this trip.');
      }

      const data = {
        pickupTripStopId: input.pickupTripStopId,
        dropoffTripStopId: input.dropoffTripStopId,
        notes: input.notes,
        membershipStatus: 'PLANNED' as const,
      };

      if (existing) {
        return tx.tripStudent.update({ where: { id: existing.id }, data, include });
      }
      return tx.tripStudent.create({ data: { schoolId: principal.schoolId, tripId, studentId: input.studentId, ...data }, include });
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'TRIP_STUDENT_ADDED',
      subjectType: 'TripStudent',
      subjectId: row.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { tripId, studentId: input.studentId },
    });

    return this.toDto(row);
  }

  async update(
    principal: AuthenticatedPrincipal,
    id: string,
    input: UpdateTripStudentInput,
    meta: RequestMeta,
  ): Promise<TripStudentDto> {
    const row = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const existing = await tx.tripStudent.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException();
      if (existing.membershipStatus === 'REMOVED') {
        throw new BadRequestException('This manifest entry has been removed.');
      }

      for (const stopId of [input.pickupTripStopId, input.dropoffTripStopId]) {
        if (!stopId) continue;
        const stop = await tx.tripStop.findFirst({ where: { id: stopId, tripId: existing.tripId } });
        if (!stop) throw new BadRequestException('The selected stop does not belong to this trip.');
      }

      return tx.tripStudent.update({
        where: { id },
        data: {
          pickupTripStopId: input.pickupTripStopId === undefined ? undefined : input.pickupTripStopId,
          dropoffTripStopId: input.dropoffTripStopId === undefined ? undefined : input.dropoffTripStopId,
          notes: input.notes,
        },
        include,
      });
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'TRIP_STUDENT_UPDATED',
      subjectType: 'TripStudent',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { fields: Object.keys(input) },
    });

    return this.toDto(row);
  }

  /** Soft-removal only — never hard-deleted, so a trip's historical manifest stays auditable. */
  async remove(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<void> {
    await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const existing = await tx.tripStudent.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException();
      if (existing.membershipStatus === 'REMOVED') {
        throw new BadRequestException('This manifest entry has already been removed.');
      }
      await tx.tripStudent.update({ where: { id }, data: { membershipStatus: 'REMOVED' } });
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'TRIP_STUDENT_REMOVED',
      subjectType: 'TripStudent',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });
  }

  private toDto(row: TripStudentRow): TripStudentDto {
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
}
