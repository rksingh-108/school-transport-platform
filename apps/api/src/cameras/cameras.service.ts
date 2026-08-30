import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { CameraDto, CameraStreamAvailabilityDto, CursorPage } from '@school-transport/shared-types';
import type { CreateCameraInput, ListCamerasQuery, UpdateCameraInput } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { TokenService } from '../auth/services/token.service';
import { BusDevicesService } from '../bus-devices/bus-devices.service';
import { toCursorPage } from '../common/pagination';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';
import type { Env } from '../config/env.schema';
import type { AuthenticatedCameraDevice } from './types/camera-device-principal';
import { CAMERA_STREAM_PROVIDER, type CameraStreamProvider } from './providers/camera-stream.provider';

type CameraRow = {
  id: string;
  busId: string;
  cameraCode: string;
  name: string;
  position: string;
  customPositionLabel: string | null;
  status: string;
  manufacturer: string | null;
  model: string | null;
  streamType: string;
  createdAt: Date;
  updatedAt: Date;
  busDevice: {
    id: string;
    externalDeviceId: string;
    firmwareVersion: string | null;
    lastSeenAt: Date | null;
    credentialSetAt: Date | null;
  };
};

/**
 * Camera inventory, bus association, lifecycle, device authentication, and
 * stream-availability (Phase 2 Step 11). See
 * docs/adr/0018-camera-device-management-foundation.md for why a Camera row
 * is a 1:1 presentation/lifecycle layer on top of a BusDevice row
 * (deviceType CAMERA_CONTROLLER) rather than a parallel device model.
 */
@Injectable()
export class CamerasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly tokenService: TokenService,
    private readonly busDevicesService: BusDevicesService,
    private readonly config: ConfigService<Env, true>,
    @Inject(CAMERA_STREAM_PROVIDER) private readonly streamProvider: CameraStreamProvider,
  ) {}

  // ---------------------------------------------------------------------
  // Device authentication (heartbeat)
  // ---------------------------------------------------------------------

  /** Used by CameraDeviceAuthGuard. Resolves a device's identity purely from its bearer credential — never from any client-supplied id. */
  async resolveDeviceByCredential(rawToken: string): Promise<AuthenticatedCameraDevice | null> {
    const hash = this.tokenService.hashOpaqueToken(rawToken);
    const device = await this.prisma.runAsPlatformAdmin((tx) =>
      tx.busDevice.findFirst({
        where: { credentialHash: hash, deviceType: 'CAMERA_CONTROLLER', status: 'ACTIVE' },
        select: { id: true, busId: true, schoolId: true },
      }),
    );
    return device ? { id: device.id, busId: device.busId, schoolId: device.schoolId } : null;
  }

  /**
   * The only writer of a camera's BusDevice.lastHealth/lastSeenAt. Carries
   * no client-asserted "online" status — arrival of this authenticated
   * request, and the resulting lastSeenAt, IS the signal; connectivity is
   * always derived from it at read time (deriveConnectivity), never stored.
   * Not audited — see docs/security.md's audit-logging section ("do not
   * audit every heartbeat").
   */
  async heartbeat(device: AuthenticatedCameraDevice, input: { firmwareVersion?: string; health?: Record<string, unknown> }): Promise<void> {
    await this.prisma.runInTenantContext(device.schoolId, (tx) =>
      tx.busDevice.update({
        where: { id: device.id },
        data: {
          lastSeenAt: new Date(),
          ...(input.firmwareVersion ? { firmwareVersion: input.firmwareVersion } : {}),
          ...(input.health ? { lastHealth: input.health as Prisma.InputJsonValue } : {}),
        },
      }),
    );
  }

  // ---------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------

  /** Every operation first confirms the bus itself belongs to the caller's tenant — a camera can never be reached through, or attached to, a foreign bus id. */
  private async assertBusInTenant(schoolId: string, busId: string): Promise<void> {
    const bus = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.bus.findFirst({ where: { id: busId, deletedAt: null } }),
    );
    if (!bus) throw new NotFoundException('No such bus.');
  }

  async listForBus(principal: AuthenticatedPrincipal, busId: string): Promise<CameraDto[]> {
    await this.assertBusInTenant(principal.schoolId, busId);
    const cameras = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.camera.findMany({ where: { busId }, orderBy: { createdAt: 'desc' }, include: { busDevice: true } }),
    );
    return cameras.map((c) => this.toDto(c));
  }

  async list(principal: AuthenticatedPrincipal, query: ListCamerasQuery): Promise<CursorPage<CameraDto>> {
    const cameras = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.camera.findMany({
        where: {
          busId: query.busId,
          status: query.status,
          ...(query.search
            ? {
                OR: [
                  { name: { contains: query.search, mode: 'insensitive' } },
                  { cameraCode: { contains: query.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        include: { busDevice: true },
        orderBy: { createdAt: 'desc' },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    );
    const page = toCursorPage(cameras, query.limit);
    return { data: page.data.map((c) => this.toDto(c)), nextCursor: page.nextCursor };
  }

  async get(principal: AuthenticatedPrincipal, id: string): Promise<CameraDto> {
    const camera = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.camera.findFirst({ where: { id }, include: { busDevice: true } }),
    );
    if (!camera) throw new NotFoundException();
    return this.toDto(camera);
  }

  async create(principal: AuthenticatedPrincipal, busId: string, input: CreateCameraInput, meta: RequestMeta): Promise<CameraDto> {
    await this.assertBusInTenant(principal.schoolId, busId);

    let camera;
    try {
      camera = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
        const device = await tx.busDevice.create({
          data: {
            schoolId: principal.schoolId,
            busId,
            deviceType: 'CAMERA_CONTROLLER',
            externalDeviceId: input.serialNumber,
            firmwareVersion: input.firmwareVersion,
          },
        });
        return tx.camera.create({
          data: {
            schoolId: principal.schoolId,
            busId,
            busDeviceId: device.id,
            cameraCode: input.cameraCode,
            name: input.name,
            position: input.position,
            customPositionLabel: input.position === 'CUSTOM' ? input.customPositionLabel : undefined,
            manufacturer: input.manufacturer,
            model: input.model,
            streamType: input.streamType,
          },
          include: { busDevice: true },
        });
      });
    } catch (err) {
      // Both cameraCode (unique per school) and serialNumber (globally unique
      // via the underlying BusDevice's externalDeviceId, same as every other
      // device type) are client-chosen identifiers, not internal invariants
      // — a collision is an ordinary, expected input-validation failure, not
      // a server error.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('A camera with this code or serial number already exists.');
      }
      throw err;
    }

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'CAMERA_CREATED',
      subjectType: 'Camera',
      subjectId: camera.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { busId, position: input.position },
    });

    return this.toDto(camera);
  }

  async update(principal: AuthenticatedPrincipal, id: string, input: UpdateCameraInput, meta: RequestMeta): Promise<CameraDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.camera.findFirst({ where: { id }, include: { busDevice: true } }),
    );
    if (!existing) throw new NotFoundException();
    if (existing.status === 'RETIRED') {
      throw new BadRequestException('This camera is retired and can no longer be updated.');
    }

    const reassigning = input.busId !== undefined && input.busId !== existing.busId;
    if (reassigning) {
      await this.assertBusInTenant(principal.schoolId, input.busId!);
    }

    let camera;
    try {
      camera = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
        if (input.firmwareVersion !== undefined) {
          await tx.busDevice.update({ where: { id: existing.busDeviceId }, data: { firmwareVersion: input.firmwareVersion } });
        }
        if (reassigning) {
          // Keep Camera.busId and its underlying BusDevice.busId in
          // lock-step — they must never independently disagree about which
          // bus a camera is on.
          await tx.busDevice.update({ where: { id: existing.busDeviceId }, data: { busId: input.busId } });
        }
        return tx.camera.update({
          where: { id },
          data: {
            cameraCode: input.cameraCode,
            name: input.name,
            position: input.position,
            customPositionLabel: input.position === 'CUSTOM' ? input.customPositionLabel : input.position ? null : undefined,
            manufacturer: input.manufacturer,
            model: input.model,
            streamType: input.streamType,
            status: input.status,
            busId: input.busId,
          },
          include: { busDevice: true },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('A camera with this code already exists.');
      }
      throw err;
    }

    const routineFields = Object.keys(input).filter((f) => f !== 'status' && f !== 'busId');
    if (routineFields.length > 0) {
      await this.auditService.record(principal.schoolId, {
        actorType: 'USER',
        actorId: principal.id,
        action: 'CAMERA_UPDATED',
        subjectType: 'Camera',
        subjectId: id,
        requestId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { fields: routineFields },
      });
    }
    if (reassigning) {
      await this.auditService.record(principal.schoolId, {
        actorType: 'USER',
        actorId: principal.id,
        action: 'CAMERA_REASSIGNED',
        subjectType: 'Camera',
        subjectId: id,
        requestId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { from: existing.busId, to: input.busId },
      });
    }
    if (input.status !== undefined && input.status !== existing.status) {
      await this.auditService.record(principal.schoolId, {
        actorType: 'USER',
        actorId: principal.id,
        action: 'CAMERA_UPDATED',
        subjectType: 'Camera',
        subjectId: id,
        requestId: meta.requestId,
        ipAddress: meta.ip,
        metadata: { from: existing.status, to: input.status },
      });
    }

    return this.toDto(camera);
  }

  /**
   * Terminal state — the only way to set status RETIRED. Also deactivates
   * the underlying BusDevice (status INACTIVE) in the same transaction:
   * resolveDeviceByCredential only ever matches ACTIVE devices, so a
   * retired camera's credential silently stops authenticating heartbeats —
   * no separate credential-revocation step is needed.
   */
  async archive(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<CameraDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.camera.findFirst({ where: { id } }));
    if (!existing) throw new NotFoundException();
    if (existing.status === 'RETIRED') {
      throw new BadRequestException('This camera is already retired.');
    }

    const camera = await this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      await tx.busDevice.update({ where: { id: existing.busDeviceId }, data: { status: 'INACTIVE' } });
      return tx.camera.update({ where: { id }, data: { status: 'RETIRED' }, include: { busDevice: true } });
    });

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'CAMERA_ARCHIVED',
      subjectType: 'Camera',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.toDto(camera);
  }

  /** Issues/rotates the underlying device's bearer credential — delegates entirely to BusDevicesService's already-tested mechanism (docs/security.md#5.1-device-security). */
  async rotateCredential(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta) {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.camera.findFirst({ where: { id } }));
    if (!existing) throw new NotFoundException();
    if (existing.status === 'RETIRED') {
      throw new BadRequestException('Cannot issue a credential for a retired camera.');
    }
    return this.busDevicesService.rotateCredential(principal, existing.busDeviceId, meta);
  }

  async getStreamAvailability(principal: AuthenticatedPrincipal, id: string): Promise<CameraStreamAvailabilityDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.camera.findFirst({ where: { id } }));
    if (!existing) throw new NotFoundException();
    return this.streamProvider.getAvailability();
  }

  private deriveConnectivity(lastSeenAt: Date | null): CameraDto['connectivity'] {
    if (!lastSeenAt) return 'UNKNOWN';
    const ageSeconds = (Date.now() - lastSeenAt.getTime()) / 1000;
    if (ageSeconds <= this.config.get('CAMERA_LIVE_THRESHOLD_SECONDS', { infer: true })) return 'ONLINE';
    if (ageSeconds <= this.config.get('CAMERA_STALE_THRESHOLD_SECONDS', { infer: true })) return 'STALE';
    return 'OFFLINE';
  }

  private toDto(camera: CameraRow): CameraDto {
    return {
      id: camera.id,
      busId: camera.busId,
      cameraCode: camera.cameraCode,
      name: camera.name,
      position: camera.position as CameraDto['position'],
      customPositionLabel: camera.customPositionLabel,
      status: camera.status as CameraDto['status'],
      manufacturer: camera.manufacturer,
      model: camera.model,
      serialNumber: camera.busDevice.externalDeviceId,
      firmwareVersion: camera.busDevice.firmwareVersion,
      streamType: camera.streamType as CameraDto['streamType'],
      connectivity: this.deriveConnectivity(camera.busDevice.lastSeenAt),
      lastSeenAt: camera.busDevice.lastSeenAt?.toISOString() ?? null,
      credentialSetAt: camera.busDevice.credentialSetAt?.toISOString() ?? null,
      createdAt: camera.createdAt.toISOString(),
      updatedAt: camera.updatedAt.toISOString(),
    };
  }
}
