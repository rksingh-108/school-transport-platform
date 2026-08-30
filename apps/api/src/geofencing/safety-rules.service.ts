import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CursorPage, SafetyRuleDto } from '@school-transport/shared-types';
import type { CreateSafetyRuleInput, ListSafetyRulesQuery, UpdateSafetyRuleInput } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';
import { toCursorPage } from '../common/pagination';

type SafetyRuleRow = {
  id: string;
  type: string;
  enabled: boolean;
  severity: string;
  geofenceId: string | null;
  routeId: string | null;
  busId: string | null;
  thresholdMeters: number | null;
  thresholdSpeedKmh: number | null;
  minConsecutivePoints: number;
  cooldownSeconds: number;
  createdBy: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  creator: { fullName: string };
  updater: { fullName: string } | null;
};

const ROW_INCLUDE = {
  creator: { select: { fullName: true } },
  updater: { select: { fullName: true } },
} satisfies Prisma.SafetyRuleInclude;

/**
 * A monitoring policy — see docs/adr/0020-geofencing-and-operational-safety-rules.md.
 * `enabled` is never settable via `update()` (only the dedicated
 * enable/disable endpoints) — see the shared-schemas comment on
 * `updateSafetyRuleSchema` for why it's structurally excluded there.
 */
@Injectable()
export class SafetyRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(principal: AuthenticatedPrincipal, query: ListSafetyRulesQuery): Promise<CursorPage<SafetyRuleDto>> {
    const rows = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.safetyRule.findMany({
        where: { type: query.type, enabled: query.enabled, busId: query.busId, routeId: query.routeId },
        include: ROW_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    );
    const page = toCursorPage(rows, query.limit);
    return { data: page.data.map((r) => this.toDto(r)), nextCursor: page.nextCursor };
  }

  async get(principal: AuthenticatedPrincipal, id: string): Promise<SafetyRuleDto> {
    const row = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.safetyRule.findFirst({ where: { id }, include: ROW_INCLUDE }),
    );
    if (!row) throw new NotFoundException();
    return this.toDto(row);
  }

  /**
   * Used by OperationalSafetyService — the "relevant rules for this
   * bus/route" query the GPS-ingestion path evaluates on every accepted
   * fix. Kept intentionally narrow (one indexed query) rather than loading
   * every school rule and filtering in memory.
   */
  async getActiveRulesForTrip(schoolId: string, busId: string, routeId: string | null): Promise<SafetyRuleRow[]> {
    return this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.safetyRule.findMany({
        where: {
          enabled: true,
          OR: [{ busId: null, routeId: null }, { busId }, ...(routeId ? [{ routeId }] : [])],
        },
        include: ROW_INCLUDE,
      }),
    );
  }

  private async assertOwnership(schoolId: string, input: { geofenceId?: string; routeId?: string; busId?: string }): Promise<void> {
    await this.prisma.runInTenantContext(schoolId, async (tx) => {
      if (input.geofenceId) {
        const geofence = await tx.geofence.findFirst({ where: { id: input.geofenceId }, select: { id: true } });
        if (!geofence) throw new NotFoundException('No such geofence.');
      }
      if (input.routeId) {
        const route = await tx.route.findFirst({ where: { id: input.routeId, deletedAt: null }, select: { id: true } });
        if (!route) throw new NotFoundException('No such route.');
      }
      if (input.busId) {
        const bus = await tx.bus.findFirst({ where: { id: input.busId, deletedAt: null }, select: { id: true } });
        if (!bus) throw new NotFoundException('No such bus.');
      }
    });
  }

  async create(principal: AuthenticatedPrincipal, input: CreateSafetyRuleInput, meta: RequestMeta): Promise<SafetyRuleDto> {
    await this.assertOwnership(principal.schoolId, input);

    const row = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.safetyRule.create({
        data: {
          schoolId: principal.schoolId,
          type: input.type,
          severity: input.severity,
          geofenceId: input.geofenceId,
          routeId: input.routeId,
          busId: input.busId,
          thresholdMeters: input.thresholdMeters,
          thresholdSpeedKmh: input.thresholdSpeedKmh,
          minConsecutivePoints: input.minConsecutivePoints,
          cooldownSeconds: input.cooldownSeconds,
          createdBy: principal.id,
        },
        include: ROW_INCLUDE,
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'SAFETY_RULE_CREATED',
      subjectType: 'SafetyRule',
      subjectId: row.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { type: input.type, severity: input.severity },
    });

    return this.toDto(row);
  }

  async update(principal: AuthenticatedPrincipal, id: string, input: UpdateSafetyRuleInput, meta: RequestMeta): Promise<SafetyRuleDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.safetyRule.findFirst({ where: { id } }));
    if (!existing) throw new NotFoundException();
    await this.assertOwnership(principal.schoolId, input);

    const row = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.safetyRule.update({
        where: { id },
        data: {
          severity: input.severity,
          geofenceId: input.geofenceId,
          routeId: input.routeId,
          busId: input.busId,
          thresholdMeters: input.thresholdMeters,
          thresholdSpeedKmh: input.thresholdSpeedKmh,
          minConsecutivePoints: input.minConsecutivePoints,
          cooldownSeconds: input.cooldownSeconds,
          updatedBy: principal.id,
        },
        include: ROW_INCLUDE,
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'SAFETY_RULE_UPDATED',
      subjectType: 'SafetyRule',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { fields: Object.keys(input) },
    });

    return this.toDto(row);
  }

  async enable(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<SafetyRuleDto> {
    return this.setEnabled(principal, id, true, 'SAFETY_RULE_ENABLED', meta);
  }

  async disable(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<SafetyRuleDto> {
    return this.setEnabled(principal, id, false, 'SAFETY_RULE_DISABLED', meta);
  }

  private async setEnabled(
    principal: AuthenticatedPrincipal,
    id: string,
    enabled: boolean,
    action: 'SAFETY_RULE_ENABLED' | 'SAFETY_RULE_DISABLED',
    meta: RequestMeta,
  ): Promise<SafetyRuleDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.safetyRule.findFirst({ where: { id } }));
    if (!existing) throw new NotFoundException();
    if (existing.enabled === enabled) {
      throw new BadRequestException(`This rule is already ${enabled ? 'enabled' : 'disabled'}.`);
    }

    const row = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.safetyRule.update({ where: { id }, data: { enabled, updatedBy: principal.id }, include: ROW_INCLUDE }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action,
      subjectType: 'SafetyRule',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.toDto(row);
  }

  private toDto(row: SafetyRuleRow): SafetyRuleDto {
    return {
      id: row.id,
      type: row.type as SafetyRuleDto['type'],
      enabled: row.enabled,
      severity: row.severity as SafetyRuleDto['severity'],
      geofenceId: row.geofenceId,
      routeId: row.routeId,
      busId: row.busId,
      thresholdMeters: row.thresholdMeters,
      thresholdSpeedKmh: row.thresholdSpeedKmh,
      minConsecutivePoints: row.minConsecutivePoints,
      cooldownSeconds: row.cooldownSeconds,
      createdBy: row.createdBy,
      createdByName: row.creator.fullName,
      updatedBy: row.updatedBy,
      updatedByName: row.updater?.fullName ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
