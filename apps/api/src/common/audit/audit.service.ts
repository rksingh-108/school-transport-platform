import { Injectable } from '@nestjs/common';
import type { ActorType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Management-domain audit events (docs/security.md#22-audit-logging) — the
 * school/staff/student/parent domain's counterpart to AuthAuditService
 * (which stays scoped to login/logout/token events; not touched here per
 * the standing instruction not to redesign authentication without a genuine
 * dependency). Both write to the same audit_logs table.
 */
export type ManagementAuditAction =
  | 'SCHOOL_UPDATED'
  | 'SCHOOL_STATUS_CHANGED'
  | 'PLATFORM_SCHOOL_ACCESSED'
  | 'STAFF_INVITED'
  | 'STAFF_INVITATION_RESENT'
  | 'STAFF_INVITATION_REVOKED'
  | 'STAFF_INVITATION_ACCEPTED'
  | 'STAFF_UPDATED'
  | 'STAFF_ROLES_UPDATED'
  | 'STAFF_SUSPENDED'
  | 'STAFF_ACTIVATED'
  | 'STUDENT_CREATED'
  | 'STUDENT_UPDATED'
  | 'STUDENT_ARCHIVED'
  | 'PARENT_CREATED'
  | 'PARENT_UPDATED'
  | 'PARENT_INVITATION_ACCEPTED'
  | 'PARENT_STUDENT_LINKED'
  | 'PARENT_STUDENT_VERIFIED'
  | 'PARENT_STUDENT_UNLINKED'
  | 'BUS_CREATED'
  | 'BUS_UPDATED'
  | 'BUS_STATUS_CHANGED'
  | 'BUS_ARCHIVED'
  | 'DRIVER_CREATED'
  | 'DRIVER_UPDATED'
  | 'DRIVER_ACTIVATED'
  | 'DRIVER_DEACTIVATED'
  | 'ATTENDANT_CREATED'
  | 'ATTENDANT_ACTIVATED'
  | 'ATTENDANT_DEACTIVATED'
  | 'DEVICE_REGISTERED'
  | 'DEVICE_UPDATED'
  | 'DEVICE_DEACTIVATED'
  | 'DEVICE_CREDENTIAL_ROTATED'
  | 'CAMERA_CREATED'
  | 'CAMERA_UPDATED'
  | 'CAMERA_REASSIGNED'
  | 'CAMERA_ARCHIVED'
  | 'ROUTE_CREATED'
  | 'ROUTE_UPDATED'
  | 'ROUTE_STATUS_CHANGED'
  | 'ROUTE_ARCHIVED'
  | 'STOP_CREATED'
  | 'STOP_UPDATED'
  | 'STOP_REORDERED'
  | 'STOP_DEACTIVATED'
  | 'STOP_DELETED'
  | 'TRIP_CREATED'
  | 'TRIP_UPDATED'
  | 'TRIP_READY'
  | 'TRIP_STARTED'
  | 'TRIP_COMPLETED'
  | 'TRIP_CANCELLED'
  | 'TRIP_NO_SHOW'
  | 'TRIP_STUDENT_ADDED'
  | 'TRIP_STUDENT_UPDATED'
  | 'TRIP_STUDENT_REMOVED'
  | 'STUDENT_BOARDED'
  | 'STUDENT_DROPPED_OFF'
  | 'STUDENT_MARKED_ABSENT'
  | 'ATTENDANCE_CORRECTED';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** For events where the tenant is known — the overwhelming majority of this domain's actions. */
  async record(
    schoolId: string,
    params: {
      actorType: ActorType;
      actorId?: string;
      action: ManagementAuditAction;
      subjectType?: string;
      subjectId?: string;
      requestId?: string;
      ipAddress?: string;
      metadata?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.auditLog.create({
        data: {
          schoolId,
          actorType: params.actorType,
          actorId: params.actorId,
          action: params.action,
          subjectType: params.subjectType,
          subjectId: params.subjectId,
          requestId: params.requestId,
          ipAddress: params.ipAddress,
          metadata: params.metadata,
        },
      }),
    );
  }
}
