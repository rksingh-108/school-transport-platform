import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AIModelDto, CursorPage } from '@school-transport/shared-types';
import type { CreateAiModelInput, ListAiModelsQuery } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { toCursorPage } from '../common/pagination';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';

type ModelRow = {
  id: string;
  name: string;
  version: string;
  provider: string;
  modelType: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * The platform-wide AI model registry (Phase 3 Step 14) — SUPER_ADMIN only
 * (`platform.ai_models.read`/`.manage`), deliberately not tenant-scoped. See
 * docs/adr/0021-edge-ai-computer-vision-pipeline-foundation.md for why this
 * is a shared ML asset catalog rather than a per-school resource, mirroring
 * the `platform.schools.*` precedent (ADR 0011) rather than every other
 * table in this schema's tenant-scoped convention.
 */
@Injectable()
export class AiModelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(query: ListAiModelsQuery): Promise<CursorPage<AIModelDto>> {
    const models = await this.prisma.aIModel.findMany({
      where: { status: query.status, modelType: query.modelType },
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = toCursorPage(models, query.limit);
    return { data: page.data.map((m) => this.toDto(m)), nextCursor: page.nextCursor };
  }

  async get(id: string): Promise<AIModelDto> {
    const model = await this.prisma.aIModel.findUnique({ where: { id } });
    if (!model) throw new NotFoundException();
    return this.toDto(model);
  }

  /**
   * Registers a NEW model version row — never mutates an existing one's
   * name/version/provider/modelType (see the ADR's "model version
   * immutability" decision). A collision on (name, version) is an ordinary
   * input error, not a server error: the caller likely meant to bump the
   * version string, not silently overwrite history.
   */
  async register(principal: AuthenticatedPrincipal, input: CreateAiModelInput, meta: RequestMeta): Promise<AIModelDto> {
    let model: ModelRow;
    try {
      model = await this.prisma.aIModel.create({
        data: { name: input.name, version: input.version, provider: input.provider, modelType: input.modelType },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('A model with this name and version is already registered.');
      }
      throw err;
    }

    await this.auditService.recordPlatform({
      actorType: 'USER',
      actorId: principal.id,
      action: 'AI_MODEL_REGISTERED',
      subjectType: 'AIModel',
      subjectId: model.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { name: input.name, version: input.version, modelType: input.modelType },
    });

    return this.toDto(model);
  }

  async activate(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<AIModelDto> {
    return this.transition(principal, id, 'ACTIVE', 'AI_MODEL_ACTIVATED', meta);
  }

  async deactivate(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<AIModelDto> {
    return this.transition(principal, id, 'INACTIVE', 'AI_MODEL_DEACTIVATED', meta);
  }

  /** Terminal — no code path ever moves a model out of DEPRECATED. */
  async deprecate(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<AIModelDto> {
    return this.transition(principal, id, 'DEPRECATED', 'AI_MODEL_DEPRECATED', meta);
  }

  private async transition(
    principal: AuthenticatedPrincipal,
    id: string,
    status: 'ACTIVE' | 'INACTIVE' | 'DEPRECATED',
    action: 'AI_MODEL_ACTIVATED' | 'AI_MODEL_DEACTIVATED' | 'AI_MODEL_DEPRECATED',
    meta: RequestMeta,
  ): Promise<AIModelDto> {
    const existing = await this.prisma.aIModel.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    if (existing.status === 'DEPRECATED') {
      throw new BadRequestException('This model version is deprecated and its status can no longer change.');
    }
    if (existing.status === status) {
      throw new BadRequestException(`This model version is already ${status}.`);
    }

    const model = await this.prisma.aIModel.update({ where: { id }, data: { status } });

    await this.auditService.recordPlatform({
      actorType: 'USER',
      actorId: principal.id,
      action,
      subjectType: 'AIModel',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { from: existing.status, to: status },
    });

    return this.toDto(model);
  }

  private toDto(model: ModelRow): AIModelDto {
    return {
      id: model.id,
      name: model.name,
      version: model.version,
      provider: model.provider,
      modelType: model.modelType as AIModelDto['modelType'],
      status: model.status as AIModelDto['status'],
      createdAt: model.createdAt.toISOString(),
      updatedAt: model.updatedAt.toISOString(),
    };
  }
}
