import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AIObservationDto, CursorPage } from '@school-transport/shared-types';
import type { EdgeAiHeartbeatInput, ListAiObservationsQuery, SubmitAiObservationInput } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { TokenService } from '../auth/services/token.service';
import { toCursorPage } from '../common/pagination';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { Env } from '../config/env.schema';
import type { AuthenticatedEdgeAiDevice } from './types/edge-ai-device-principal';
import { AiObservationsGateway } from './ai-observations.gateway';
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
  createdAt: Date;
  model: { name: string };
};

/**
 * Edge-AI device authentication, observation ingestion (dedup/temporal
 * aggregation, timestamp sanity), and staff-facing read access (Phase 3
 * Step 14). See docs/adr/0021-edge-ai-computer-vision-pipeline-foundation.md.
 * Deliberately does NOT create a SafetyEvent or Emergency from any
 * observation — that boundary belongs to Step 15.
 */
@Injectable()
export class AiObservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly config: ConfigService<Env, true>,
    private readonly gateway: AiObservationsGateway,
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
          include: { model: { select: { name: true } } },
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
            include: { model: { select: { name: true } } },
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
        include: { model: { select: { name: true } } },
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
      tx.aIObservation.findFirst({ where: { id }, include: { model: { select: { name: true } } } }),
    );
    if (!observation) throw new NotFoundException();
    return this.toDto(observation);
  }

  getProviderHealth(): AiProviderHealth {
    return this.provider.getHealth();
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
      createdAt: row.createdAt.toISOString(),
    };
  }
}
