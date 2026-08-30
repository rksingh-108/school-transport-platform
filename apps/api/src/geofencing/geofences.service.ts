import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CursorPage, GeofenceDto } from '@school-transport/shared-types';
import type { CreateGeofenceInput, ListGeofencesQuery, UpdateGeofenceInput } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { toCursorPage } from '../common/pagination';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';

type GeofenceRow = {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * A standalone circular zone (Haversine center + radius) — see
 * docs/adr/0020-geofencing-and-operational-safety-rules.md for why there is
 * no fourth "STOP" type and no bus/route/stop association on the geofence
 * itself (that scoping lives on `SafetyRule` instead, so one geofence can
 * be watched by multiple rules with different scopes).
 */
@Injectable()
export class GeofencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(principal: AuthenticatedPrincipal, query: ListGeofencesQuery): Promise<CursorPage<GeofenceDto>> {
    const rows = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.geofence.findMany({
        where: { status: query.status, type: query.type },
        orderBy: { createdAt: 'desc' },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    );
    const page = toCursorPage(rows, query.limit);
    return { data: page.data.map((r) => this.toDto(r)), nextCursor: page.nextCursor };
  }

  async get(principal: AuthenticatedPrincipal, id: string): Promise<GeofenceDto> {
    const row = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.geofence.findFirst({ where: { id } }));
    if (!row) throw new NotFoundException();
    return this.toDto(row);
  }

  /** Used by OperationalSafetyService to resolve a rule's target geofence — not tenant-principal-scoped since the caller already established tenant context. */
  async getRawById(schoolId: string, id: string): Promise<GeofenceRow | null> {
    return this.prisma.runInTenantContext(schoolId, (tx) => tx.geofence.findFirst({ where: { id, status: 'ACTIVE' } }));
  }

  async create(principal: AuthenticatedPrincipal, input: CreateGeofenceInput, meta: RequestMeta): Promise<GeofenceDto> {
    const row = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.geofence.create({
        data: {
          schoolId: principal.schoolId,
          name: input.name,
          type: input.type,
          latitude: input.latitude,
          longitude: input.longitude,
          radiusMeters: input.radiusMeters,
        },
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'GEOFENCE_CREATED',
      subjectType: 'Geofence',
      subjectId: row.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { type: input.type },
    });

    return this.toDto(row);
  }

  async update(principal: AuthenticatedPrincipal, id: string, input: UpdateGeofenceInput, meta: RequestMeta): Promise<GeofenceDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.geofence.findFirst({ where: { id } }));
    if (!existing) throw new NotFoundException();
    if (existing.status === 'ARCHIVED') {
      throw new BadRequestException('This geofence is archived and can no longer be updated.');
    }

    const row = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.geofence.update({
        where: { id },
        data: {
          name: input.name,
          type: input.type,
          latitude: input.latitude,
          longitude: input.longitude,
          radiusMeters: input.radiusMeters,
          status: input.status,
        },
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'GEOFENCE_UPDATED',
      subjectType: 'Geofence',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { fields: Object.keys(input) },
    });

    return this.toDto(row);
  }

  /**
   * Terminal — never hard-deleted (a SafetyRule may reference it, and past
   * SafetyEvents reference the rule that referenced it). Also disables any
   * SafetyRule still pointing at it, in the same transaction — an enabled
   * rule watching a semantically-retired place would otherwise silently
   * keep evaluating a geofence staff believe no longer applies.
   */
  async archive(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<GeofenceDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.geofence.findFirst({ where: { id } }));
    if (!existing) throw new NotFoundException();
    if (existing.status === 'ARCHIVED') {
      throw new BadRequestException('This geofence is already archived.');
    }

    const row = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      await tx.safetyRule.updateMany({ where: { geofenceId: id, enabled: true }, data: { enabled: false } });
      return tx.geofence.update({ where: { id }, data: { status: 'ARCHIVED' } });
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'GEOFENCE_ARCHIVED',
      subjectType: 'Geofence',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.toDto(row);
  }

  private toDto(row: GeofenceRow): GeofenceDto {
    return {
      id: row.id,
      name: row.name,
      type: row.type as GeofenceDto['type'],
      latitude: row.latitude,
      longitude: row.longitude,
      radiusMeters: row.radiusMeters,
      status: row.status as GeofenceDto['status'],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
