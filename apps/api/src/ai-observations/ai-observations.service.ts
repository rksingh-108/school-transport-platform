import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AIObservationDto, CursorPage } from '@school-transport/shared-types';
import type {
  DismissAiObservationInput,
  EdgeAiHeartbeatInput,
  ListAiObservationsQuery,
  PromoteAiObservationInput,
  ReviewAiObservationInput,
  SubmitAiObservationInput,
} from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { TokenService } from '../auth/services/token.service';
import { toCursorPage } from '../common/pagination';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';
import type { Env } from '../config/env.schema';
import { SafetyEventsService } from '../safety/safety-events.service';
import type { AuthenticatedEdgeAiDevice } from './types/edge-ai-device-principal';
import { AiObservationsGateway } from './ai-observations.gateway';
import { AiSafetyPoliciesService } from './ai-safety-policies.service';
import { AI_DETECTION_TO_SAFETY_EVENT_TYPE } from './policies/ai-safety-policy.constants';
import { COMPUTER_VISION_PROVIDER, type ComputerVisionProvider, type AiProviderHealth } from './providers/computer-vision.provider';
import { assertObservationTimestampSane, computeWindowStart, ObservationTimestampError } from './util/observation-window';

type ObservationRow = {
  id: string;
  busId: string;
  tripId: string | null;
  cameraId: string;
  edgeDeviceId: string;
  modelId: string;
  modelVersion: string;
  detectionType: string;
  confidence: number;
  occurredAt: Date;
  receivedAt: Date;
  status: string;
  evidenceReference: string | null;
  metadata: Prisma.JsonValue;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
  model: { name: string };
  reviewer: { fullName: string } | null;
  promotedSafetyEvent: { id: string } | null;
};

const OBSERVATION_INCLUDE = {
  model: { select: { name: true } },
  reviewer: { select: { fullName: true } },
  promotedSafetyEvent: { select: { id: true } },
} satisfies Prisma.AIObservationInclude;

/** Only these transitions are reachable through a direct staff endpoint call — see docs/adr/0022-ai-observation-review-and-safety-analytics.md. */
const REVIEW_TRANSITIONS: Record<string, { review: boolean; dismiss: boolean; promote: boolean }> = {
  CANDIDATE: { review: true, dismiss: true, promote: true },
  REVIEWED: { review: false, dismiss: true, promote: true },
  DISMISSED: { review: false, dismiss: false, promote: false },
  PROMOTED: { review: false, dismiss: false, promote: false },
};

/**
 * Edge-AI device authentication, observation ingestion (dedup/temporal
 * aggregation, timestamp sanity), staff-facing reads, and the human
 * review/promotion workflow (Phase 3 Step 14 + Step 15). See
 * docs/adr/0021-edge-ai-computer-vision-pipeline-foundation.md and
 * docs/adr/0022-ai-observation-review-and-safety-analytics.md. Never
 * creates a SafetyEvent automatically — `promote()` is reachable only
 * through an authenticated staff member's explicit
 * `POST /ai-observations/:id/promote` call, and never from the ingestion
 * path itself.
 */
@Injectable()
export class AiObservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService<Env, true>,
    private readonly gateway: AiObservationsGateway,
    private readonly policiesService: AiSafetyPoliciesService,
    private readonly safetyEventsService: SafetyEventsService,
    @Inject(COMPUTER_VISION_PROVIDER) private readonly provider: ComputerVisionProvider,
  ) {}

  // ---------------------------------------------------------------------
  // Device authentication
  // ---------------------------------------------------------------------

  /** Used by EdgeAiDeviceAuthGuard. Resolves a device's identity purely from its bearer credential — never from any client-supplied id. */
  async resolveDeviceByCredential(rawToken: string): Promise<AuthenticatedEdgeAiDevice | null> {
    const hash = this.tokenService.hashOpaqueToken(rawToken);
    const device = await this.prisma.runAsPlatformAdmin((tx) =>
      tx.busDevice.findFirst({
        where: { credentialHash: hash, deviceType: 'EDGE_COMPUTER', status: 'ACTIVE' },
        select: { id: true, busId: true, schoolId: true },
      }),
    );
    return device ? { id: device.id, busId: device.busId, schoolId: device.schoolId } : null;
  }

  /**
   * Health-only ping — carries no "online" field; arrival of this
   * authenticated request, recorded as lastSeenAt, is the entire signal
   * (same convention as CamerasService.heartbeat). Not audited — see
   * docs/security.md's "do not audit every heartbeat" note.
   */
  async heartbeat(device: AuthenticatedEdgeAiDevice, input: EdgeAiHeartbeatInput): Promise<void> {
    await this.prisma.runInTenantContext(device.schoolId, (tx) =>
      tx.busDevice.update({
        where: { id: device.id },
        data: {
          lastSeenAt: new Date(),
          ...(input.firmwareVersion ? { firmwareVersion: input.firmwareVersion } : {}),
          ...(input.health || input.activeModel || input.activeModelVersion
            ? {
                lastHealth: {
                  ...(input.health ?? {}),
                  ...(input.activeModel ? { activeModel: input.activeModel } : {}),
                  ...(input.activeModelVersion ? { activeModelVersion: input.activeModelVersion } : {}),
                } as Prisma.InputJsonValue,
              }
            : {}),
        },
      }),
    );
  }

  // ---------------------------------------------------------------------
  // Ingestion
  // ---------------------------------------------------------------------

  async ingest(device: AuthenticatedEdgeAiDevice, input: SubmitAiObservationInput): Promise<AIObservationDto> {
    const occurredAt = new Date(input.occurredAt);
    const now = new Date();
    try {
      assertObservationTimestampSane(
        occurredAt,
        now,
        this.config.get('AI_OBSERVATION_MAX_FUTURE_SKEW_SECONDS', { infer: true }),
        this.config.get('AI_OBSERVATION_MAX_PAST_AGE_SECONDS', { infer: true }),
      );
    } catch (err) {
      if (err instanceof ObservationTimestampError) throw new BadRequestException(err.message);
      throw err;
    }

    const minConfidence = this.config.get('AI_OBSERVATION_MIN_CONFIDENCE', { infer: true });
    if (input.confidence < minConfidence) {
      throw new BadRequestException(`confidence is below the configured minimum (${minConfidence}).`);
    }

    // The camera must both belong to this device's own tenant/bus AND be
    // explicitly assigned to THIS edge device (Camera.edgeDeviceId) — being
    // on the same bus is not enough; staff must have deliberately assigned
    // this camera to this device first. 404, not 400: existence is never
    // revealed for a foreign/unassigned camera, same convention as every
    // other cross-tenant check in this codebase.
    const camera = await this.prisma.runInTenantContext(device.schoolId, (tx) =>
      tx.camera.findFirst({
        where: { id: input.cameraId, busId: device.busId, edgeDeviceId: device.id },
        select: { id: true },
      }),
    );
    if (!camera) throw new NotFoundException('No such camera assigned to this edge device.');

    // Platform-wide registry lookup by natural key — never an internal id a
    // physical device would have no reason to know. An unknown or inactive
    // model is a clean 400 (a configuration problem, not "does this
    // resource exist" in the tenant-IDOR sense — the registry isn't
    // tenant-scoped at all).
    const model = await this.prisma.aIModel.findFirst({
      where: { name: input.modelName, version: input.modelVersion, status: 'ACTIVE' },
      select: { id: true, version: true },
    });
    if (!model) throw new BadRequestException('Unknown or inactive AI model name/version.');

    // Server-derived, never accepted from the device — the bus's own
    // current trip, or none. Exactly the same resolution GPS ingestion uses
    // for its own tripId.
    const activeTrip = await this.prisma.runInTenantContext(device.schoolId, (tx) =>
      tx.trip.findFirst({ where: { busId: device.busId, status: 'IN_PROGRESS' }, select: { id: true } }),
    );

    const windowSeconds = this.config.get('AI_OBSERVATION_DEDUP_WINDOW_SECONDS', { infer: true });
    const windowStart = computeWindowStart(occurredAt, windowSeconds);
    const metadata = input.metadata as Prisma.InputJsonValue | undefined;

    let created = true;
    let row: ObservationRow;
    try {
      row = await this.prisma.runInTenantContext(device.schoolId, (tx) =>
        tx.aIObservation.create({
          data: {
            schoolId: device.schoolId,
            busId: device.busId,
            tripId: activeTrip?.id ?? null,
            cameraId: input.cameraId,
            edgeDeviceId: device.id,
            modelId: model.id,
            modelVersion: model.version,
            detectionType: input.detectionType,
            confidence: input.confidence,
            occurredAt,
            windowStart,
            metadata,
          },
          include: OBSERVATION_INCLUDE,
        }),
      );
    } catch (err) {
      // Retry-safe temporal aggregation: a repeated detection of the same
      // type from the same camera+edge device within the same window
      // updates the existing candidate (latest confidence/timestamp wins)
      // instead of creating a second row — see the ADR's dedup decision.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        created = false;
        row = await this.prisma.runInTenantContext(device.schoolId, (tx) =>
          tx.aIObservation.update({
            where: {
              edgeDeviceId_cameraId_detectionType_windowStart: {
                edgeDeviceId: device.id,
                cameraId: input.cameraId,
                detectionType: input.detectionType,
                windowStart,
              },
            },
            data: { confidence: input.confidence, occurredAt, receivedAt: now, tripId: activeTrip?.id ?? null, metadata },
            include: OBSERVATION_INCLUDE,
          }),
        );
      } else {
        throw err;
      }
    }

    await this.prisma.runInTenantContext(device.schoolId, (tx) =>
      tx.busDevice.update({ where: { id: device.id }, data: { lastSeenAt: now } }),
    );

    const dto = this.toDto(row);
    if (created) {
      this.gateway.emitObservationCreated(device.schoolId, dto);
    } else {
      this.gateway.emitObservationUpdated(device.schoolId, dto);
    }
    return dto;
  }

  // ---------------------------------------------------------------------
  // Staff-facing reads
  // ---------------------------------------------------------------------

  async list(principal: AuthenticatedPrincipal, query: ListAiObservationsQuery): Promise<CursorPage<AIObservationDto>> {
    const observations = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.aIObservation.findMany({
        where: {
          detectionType: query.detectionType,
          status: query.status,
          busId: query.busId,
          cameraId: query.cameraId,
          confidence: query.minConfidence !== undefined ? { gte: query.minConfidence } : undefined,
          occurredAt:
            query.from || query.to
              ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined }
              : undefined,
        },
        include: OBSERVATION_INCLUDE,
        orderBy: { occurredAt: 'desc' },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    );
    const page = toCursorPage(observations, query.limit);
    return { data: page.data.map((o) => this.toDto(o)), nextCursor: page.nextCursor };
  }

  async get(principal: AuthenticatedPrincipal, id: string): Promise<AIObservationDto> {
    const observation = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.aIObservation.findFirst({ where: { id }, include: OBSERVATION_INCLUDE }),
    );
    if (!observation) throw new NotFoundException();
    return this.toDto(observation);
  }

  getProviderHealth(): AiProviderHealth {
    return this.provider.getHealth();
  }

  // ---------------------------------------------------------------------
  // Human review workflow (Phase 3 Step 15) — see
  // docs/adr/0022-ai-observation-review-and-safety-analytics.md. Three
  // dedicated endpoints, never a generic PATCH; the original AI detection
  // (model/modelVersion/confidence/occurredAt/cameraId/edgeDeviceId) is
  // never mutated by any of them.
  // ---------------------------------------------------------------------

  /** CANDIDATE → REVIEWED — a lightweight "seen, still deciding" marker. */
  async review(principal: AuthenticatedPrincipal, id: string, input: ReviewAiObservationInput, meta: RequestMeta): Promise<AIObservationDto> {
    const existing = await this.getOwnRow(principal, id);
    if (!REVIEW_TRANSITIONS[existing.status]?.review) {
      throw new BadRequestException(`Cannot review an observation with status ${existing.status}.`);
    }

    const row = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.aIObservation.update({
        where: { id },
        data: { status: 'REVIEWED', reviewedBy: principal.id, reviewedAt: new Date(), reviewNote: input.reviewNote },
        include: OBSERVATION_INCLUDE,
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'AI_OBSERVATION_REVIEWED',
      subjectType: 'AIObservation',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    const dto = this.toDto(row);
    this.gateway.emitObservationUpdated(principal.schoolId, dto);
    return dto;
  }

  /** {CANDIDATE, REVIEWED} → DISMISSED — terminal, no SafetyEvent is ever created. */
  async dismiss(principal: AuthenticatedPrincipal, id: string, input: DismissAiObservationInput, meta: RequestMeta): Promise<AIObservationDto> {
    const existing = await this.getOwnRow(principal, id);
    if (!REVIEW_TRANSITIONS[existing.status]?.dismiss) {
      throw new BadRequestException(`Cannot dismiss an observation with status ${existing.status}.`);
    }

    const row = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.aIObservation.update({
        where: { id },
        data: { status: 'DISMISSED', reviewedBy: principal.id, reviewedAt: new Date(), reviewNote: input.reviewNote },
        include: OBSERVATION_INCLUDE,
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'AI_OBSERVATION_DISMISSED',
      subjectType: 'AIObservation',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    const dto = this.toDto(row);
    this.gateway.emitObservationUpdated(principal.schoolId, dto);
    return dto;
  }

  /**
   * {CANDIDATE, REVIEWED} → PROMOTED — creates the linked SafetyEvent in
   * the SAME transaction as the status transition, so a failure anywhere
   * (policy check, SafetyEvent insert, observation update) leaves NO
   * partial state: either both rows change together, or neither does (see
   * the ADR's "promotion transaction" and "failure modes" decisions).
   * Gated by the school's effective `AiSafetyPolicy` for this detection
   * type (falling back to a conservative system default if none is
   * configured) — `enabled: false` or a confidence below the policy's bar
   * rejects with 400 before anything is written. The `@unique` constraint
   * on `SafetyEvent.sourceAiObservationId` is the database-level guarantee
   * that two concurrent promote attempts on the same observation can never
   * both succeed — the loser's transaction fails on a unique-violation and
   * is surfaced as a clean 400, never a silently-duplicated SafetyEvent.
   */
  async promote(principal: AuthenticatedPrincipal, id: string, input: PromoteAiObservationInput, meta: RequestMeta): Promise<AIObservationDto> {
    const existing = await this.getOwnRow(principal, id);
    if (!REVIEW_TRANSITIONS[existing.status]?.promote) {
      throw new BadRequestException(`Cannot promote an observation with status ${existing.status}.`);
    }

    const policy = await this.policiesService.resolveEffectivePolicy(principal.schoolId, existing.detectionType);
    if (!policy.enabled) {
      throw new BadRequestException(`Promotion is not enabled for ${existing.detectionType} at this school.`);
    }
    if (existing.confidence < policy.minimumConfidence) {
      throw new BadRequestException(`This observation's confidence (${existing.confidence}) is below the configured minimum (${policy.minimumConfidence}) for ${existing.detectionType}.`);
    }

    const safetyEventType = AI_DETECTION_TO_SAFETY_EVENT_TYPE[existing.detectionType as keyof typeof AI_DETECTION_TO_SAFETY_EVENT_TYPE];
    const severity = input.severity ?? policy.defaultSeverity;

    let safetyEventRow!: Awaited<ReturnType<SafetyEventsService['createRowFromAiObservation']>>;
    let observationRow!: ObservationRow;
    try {
      await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
        safetyEventRow = await this.safetyEventsService.createRowFromAiObservation(tx, {
          schoolId: principal.schoolId,
          busId: existing.busId,
          tripId: existing.tripId,
          cameraId: existing.cameraId,
          type: safetyEventType,
          severity,
          description: `Promoted from AI observation (${existing.detectionType}, ${(existing.confidence * 100).toFixed(0)}% confidence, ${existing.model.name} ${existing.modelVersion}).`,
          metadata: (existing.metadata as Record<string, unknown> | null) ?? undefined,
          createdBy: principal.id,
          sourceAiObservationId: id,
        });
        observationRow = await tx.aIObservation.update({
          where: { id },
          data: { status: 'PROMOTED', reviewedBy: principal.id, reviewedAt: new Date(), reviewNote: input.reviewNote },
          include: OBSERVATION_INCLUDE,
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('This observation has already been promoted to a safety event.');
      }
      throw err;
    }

    await this.safetyEventsService.afterAiPromotion(principal.schoolId, principal.id, safetyEventRow, meta);

    const dto = this.toDto(observationRow);
    this.gateway.emitObservationUpdated(principal.schoolId, dto);
    return dto;
  }

  /** Tenant-scoped existence check shared by review/dismiss/promote — 404 for a cross-tenant or nonexistent id. */
  private async getOwnRow(principal: AuthenticatedPrincipal, id: string): Promise<ObservationRow> {
    const row = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.aIObservation.findFirst({ where: { id }, include: OBSERVATION_INCLUDE }),
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  private toDto(row: ObservationRow): AIObservationDto {
    return {
      id: row.id,
      busId: row.busId,
      tripId: row.tripId,
      cameraId: row.cameraId,
      edgeDeviceId: row.edgeDeviceId,
      modelId: row.modelId,
      modelName: row.model.name,
      modelVersion: row.modelVersion,
      detectionType: row.detectionType as AIObservationDto['detectionType'],
      confidence: row.confidence,
      occurredAt: row.occurredAt.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
      status: row.status as AIObservationDto['status'],
      evidenceReference: row.evidenceReference,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      reviewedBy: row.reviewedBy,
      reviewedByName: row.reviewer?.fullName ?? null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewNote: row.reviewNote,
      safetyEventId: row.promotedSafetyEvent?.id ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
