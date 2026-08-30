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
  | 'SAFETY_EVENT_CREATED'
  | 'SAFETY_EVENT_ACKNOWLEDGED'
  | 'SAFETY_EVENT_DISMISSED'
  | 'SAFETY_EVENT_ESCALATED'
  | 'SAFETY_EVENT_RESOLVED'
  | 'EMERGENCY_CREATED'
  | 'EMERGENCY_ACKNOWLEDGED'
  | 'EMERGENCY_ACTION_ADDED'
  | 'EMERGENCY_RESOLVED'
  | 'EMERGENCY_CANCELLED'
  | 'GEOFENCE_CREATED'
  | 'GEOFENCE_UPDATED'
  | 'GEOFENCE_ARCHIVED'
  | 'SAFETY_RULE_CREATED'
  | 'SAFETY_RULE_UPDATED'
  | 'SAFETY_RULE_ENABLED'
  | 'SAFETY_RULE_DISABLED'
  | 'AI_MODEL_REGISTERED'
  | 'AI_MODEL_ACTIVATED'
  | 'AI_MODEL_DEACTIVATED'
  | 'AI_MODEL_DEPRECATED'
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

  /**
   * For genuinely platform-wide actions with no target school at all (e.g.
   * registering a model in the shared, platform-wide AI model registry —
   * Phase 3 Step 14). `audit_logs.school_id` is nullable specifically for
   * this case, readable only under `app.is_platform_admin` (see the
   * `tenant_isolation` policy comment in the init migration). Do not use
   * this for an action that DOES have a natural target school — `record()`
   * with that school's id is correct there (see SchoolsService.updateStatus
   * for the platform-managed-but-still-per-school precedent).
   */
  async recordPlatform(params: {
    actorType: ActorType;
    actorId?: string;
    action: ManagementAuditAction;
    subjectType?: string;
    subjectId?: string;
    requestId?: string;
    ipAddress?: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.runAsPlatformAdmin((tx) =>
      tx.auditLog.create({
        data: {
          schoolId: null,
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
