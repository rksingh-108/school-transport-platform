import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AiSafetyPolicyDto } from '@school-transport/shared-types';
import type { CreateAiSafetyPolicyInput, ListAiSafetyPoliciesQuery, UpdateAiSafetyPolicyInput } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';
import { SYSTEM_DEFAULT_AI_SAFETY_POLICY, type AiSafetyPolicyValues } from './policies/ai-safety-policy.constants';

type PolicyRow = {
  id: string;
  detectionType: string;
  enabled: boolean;
  minimumConfidence: number;
  defaultSeverity: string;
  requiresHumanReview: boolean;
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
} satisfies Prisma.AiSafetyPolicyInclude;

/**
 * Per-school AI promotion policy configuration (Phase 3 Step 15) — see
 * docs/adr/0022-ai-observation-review-and-safety-analytics.md. Tenant-
 * scoped, unlike the platform-wide AIModel registry. `enabled` is toggled
 * only via dedicated enable/disable endpoints, `detectionType` is fixed at
 * creation — the same lifecycle discipline SafetyRule already established.
 */
@Injectable()
export class AiSafetyPoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(principal: AuthenticatedPrincipal, query: ListAiSafetyPoliciesQuery): Promise<AiSafetyPolicyDto[]> {
    const rows = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.aiSafetyPolicy.findMany({
        where: { detectionType: query.detectionType, enabled: query.enabled },
        include: ROW_INCLUDE,
        orderBy: { detectionType: 'asc' },
      }),
    );
    return rows.map((r) => this.toDto(r));
  }

  async get(principal: AuthenticatedPrincipal, id: string): Promise<AiSafetyPolicyDto> {
    const row = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.aiSafetyPolicy.findFirst({ where: { id }, include: ROW_INCLUDE }),
    );
    if (!row) throw new NotFoundException();
    return this.toDto(row);
  }

  /** Registers this school's policy for one detection type — a collision on (school, detectionType) is a clean 400 (use PATCH/enable/disable on the existing row instead). Created disabled — see the schema's own enable/disable convention. */
  async create(principal: AuthenticatedPrincipal, input: CreateAiSafetyPolicyInput, meta: RequestMeta): Promise<AiSafetyPolicyDto> {
    let row: PolicyRow;
    try {
      row = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
        tx.aiSafetyPolicy.create({
          data: {
            schoolId: principal.schoolId,
            detectionType: input.detectionType,
            minimumConfidence: input.minimumConfidence,
            defaultSeverity: input.defaultSeverity,
            requiresHumanReview: input.requiresHumanReview ?? true,
            createdBy: principal.id,
          },
          include: ROW_INCLUDE,
        }),
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('A policy for this detection type already exists — update it instead.');
      }
      throw err;
    }

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'AI_SAFETY_POLICY_CREATED',
      subjectType: 'AiSafetyPolicy',
      subjectId: row.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { detectionType: row.detectionType },
    });

    return this.toDto(row);
  }

  async update(principal: AuthenticatedPrincipal, id: string, input: UpdateAiSafetyPolicyInput, meta: RequestMeta): Promise<AiSafetyPolicyDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.aiSafetyPolicy.findFirst({ where: { id } }));
    if (!existing) throw new NotFoundException();

    const row = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.aiSafetyPolicy.update({
        where: { id },
        data: {
          minimumConfidence: input.minimumConfidence,
          defaultSeverity: input.defaultSeverity,
          requiresHumanReview: input.requiresHumanReview,
          updatedBy: principal.id,
        },
        include: ROW_INCLUDE,
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'AI_SAFETY_POLICY_UPDATED',
      subjectType: 'AiSafetyPolicy',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { fields: Object.keys(input) },
    });

    return this.toDto(row);
  }

  async enable(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<AiSafetyPolicyDto> {
    return this.setEnabled(principal, id, true, 'AI_SAFETY_POLICY_ENABLED', meta);
  }

  async disable(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<AiSafetyPolicyDto> {
    return this.setEnabled(principal, id, false, 'AI_SAFETY_POLICY_DISABLED', meta);
  }

  private async setEnabled(
    principal: AuthenticatedPrincipal,
    id: string,
    enabled: boolean,
    action: 'AI_SAFETY_POLICY_ENABLED' | 'AI_SAFETY_POLICY_DISABLED',
    meta: RequestMeta,
  ): Promise<AiSafetyPolicyDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.aiSafetyPolicy.findFirst({ where: { id } }));
    if (!existing) throw new NotFoundException();
    if (existing.enabled === enabled) {
      throw new BadRequestException(`This policy is already ${enabled ? 'enabled' : 'disabled'}.`);
    }

    const row = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.aiSafetyPolicy.update({ where: { id }, data: { enabled, updatedBy: principal.id }, include: ROW_INCLUDE }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action,
      subjectType: 'AiSafetyPolicy',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.toDto(row);
  }

  /**
   * Used internally by `AiObservationsService.promote()` — never by any
   * controller. Falls back to the conservative hardcoded system default
   * (never "anything goes") when the school has no policy row for this
   * detection type — see the ADR's "defaults" decision.
   */
  async resolveEffectivePolicy(schoolId: string, detectionType: string): Promise<AiSafetyPolicyValues> {
    const row = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.aiSafetyPolicy.findUnique({ where: { schoolId_detectionType: { schoolId, detectionType: detectionType as never } } }),
    );
    if (!row) return SYSTEM_DEFAULT_AI_SAFETY_POLICY[detectionType as keyof typeof SYSTEM_DEFAULT_AI_SAFETY_POLICY];
    return {
      enabled: row.enabled,
      minimumConfidence: row.minimumConfidence,
      defaultSeverity: row.defaultSeverity as AiSafetyPolicyValues['defaultSeverity'],
      requiresHumanReview: row.requiresHumanReview,
    };
  }

  private toDto(row: PolicyRow): AiSafetyPolicyDto {
    return {
      id: row.id,
      detectionType: row.detectionType as AiSafetyPolicyDto['detectionType'],
      enabled: row.enabled,
      minimumConfidence: row.minimumConfidence,
      defaultSeverity: row.defaultSeverity as AiSafetyPolicyDto['defaultSeverity'],
      requiresHumanReview: row.requiresHumanReview,
      createdBy: row.createdBy,
      createdByName: row.creator.fullName,
      updatedBy: row.updatedBy,
      updatedByName: row.updater?.fullName ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
