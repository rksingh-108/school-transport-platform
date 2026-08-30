import { Injectable, NotFoundException } from '@nestjs/common';
import type { BusDeviceDto, DeviceCredentialDto } from '@school-transport/shared-types';
import type { CreateDeviceInput, UpdateDeviceInput } from '@school-transport/shared-schemas';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { TokenService } from '../auth/services/token.service';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import type { RequestMeta } from '../auth/services/auth.service';

type DeviceRow = {
  id: string;
  busId: string;
  deviceType: string;
  externalDeviceId: string;
  firmwareVersion: string | null;
  metadata: Prisma.JsonValue;
  status: string;
  credentialSetAt: Date | null;
  lastSeenAt: Date | null;
  installedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class BusDevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly tokenService: TokenService,
  ) {}

  /** Every operation first confirms the bus itself belongs to the caller's tenant — a device can never be reached through a foreign bus id. */
  private async assertBusInTenant(schoolId: string, busId: string): Promise<void> {
    const bus = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.bus.findFirst({ where: { id: busId, deletedAt: null } }),
    );
    if (!bus) throw new NotFoundException('No such bus.');
  }

  async listForBus(principal: AuthenticatedPrincipal, busId: string): Promise<BusDeviceDto[]> {
    await this.assertBusInTenant(principal.schoolId, busId);
    const devices = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.busDevice.findMany({ where: { busId }, orderBy: { createdAt: 'desc' } }),
    );
    return devices.map((d) => this.toDto(d));
  }

  async get(principal: AuthenticatedPrincipal, id: string): Promise<BusDeviceDto> {
    const device = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.busDevice.findFirst({ where: { id } }));
    if (!device) throw new NotFoundException();
    return this.toDto(device);
  }

  async create(
    principal: AuthenticatedPrincipal,
    busId: string,
    input: CreateDeviceInput,
    meta: RequestMeta,
  ): Promise<BusDeviceDto> {
    await this.assertBusInTenant(principal.schoolId, busId);

    const device = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.busDevice.create({
        data: {
          schoolId: principal.schoolId,
          busId,
          deviceType: input.deviceType,
          externalDeviceId: input.externalDeviceId,
          firmwareVersion: input.firmwareVersion,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'DEVICE_REGISTERED',
      subjectType: 'BusDevice',
      subjectId: device.id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { busId, deviceType: input.deviceType },
    });

    return this.toDto(device);
  }

  async update(principal: AuthenticatedPrincipal, id: string, input: UpdateDeviceInput, meta: RequestMeta): Promise<BusDeviceDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.busDevice.findFirst({ where: { id } }));
    if (!existing) throw new NotFoundException();

    const device = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.busDevice.update({
        where: { id },
        data: {
          externalDeviceId: input.externalDeviceId,
          firmwareVersion: input.firmwareVersion,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
          status: input.status,
        },
      }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'DEVICE_UPDATED',
      subjectType: 'BusDevice',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
      metadata: { fields: Object.keys(input) },
    });

    return this.toDto(device);
  }

  /** Terminal-for-now state — no reactivate endpoint is offered (not requested; mirrors Student's one-way archive). */
  async deactivate(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<BusDeviceDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.busDevice.findFirst({ where: { id } }));
    if (!existing) throw new NotFoundException();

    const device = await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.busDevice.update({ where: { id }, data: { status: 'INACTIVE' } }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'DEVICE_DEACTIVATED',
      subjectType: 'BusDevice',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return this.toDto(device);
  }

  /**
   * Issues (or rotates) this device's GPS-ingestion bearer credential. The
   * raw token is returned exactly once — only its SHA-256 hash is
   * persisted, the same generate/hash mechanics `TokenService` already uses
   * for refresh/reset/invitation tokens (docs/security.md#5.1-device-security).
   * Rotating overwrites the previous hash outright: the old token stops
   * working immediately, there is no overlap window, matching the "no
   * reactivate" one-way spirit already used for `deactivate()` above but
   * for a credential rather than a status.
   */
  async rotateCredential(principal: AuthenticatedPrincipal, id: string, meta: RequestMeta): Promise<DeviceCredentialDto> {
    const existing = await this.prisma.runInTenantContext(principal.schoolId, (tx) => tx.busDevice.findFirst({ where: { id } }));
    if (!existing) throw new NotFoundException();

    const { raw, hash } = this.tokenService.generateOpaqueToken();
    const issuedAt = new Date();
    await this.prisma.runInTenantContext(principal.schoolId, (tx) =>
      tx.busDevice.update({ where: { id }, data: { credentialHash: hash, credentialSetAt: issuedAt } }),
    );

    await this.auditService.record(principal.schoolId, {
      actorType: 'USER',
      actorId: principal.id,
      action: 'DEVICE_CREDENTIAL_ROTATED',
      subjectType: 'BusDevice',
      subjectId: id,
      requestId: meta.requestId,
      ipAddress: meta.ip,
    });

    return { deviceId: id, token: raw, issuedAt: issuedAt.toISOString() };
  }

  private toDto(device: DeviceRow): BusDeviceDto {
    return {
      id: device.id,
      busId: device.busId,
      deviceType: device.deviceType as BusDeviceDto['deviceType'],
      externalDeviceId: device.externalDeviceId,
      firmwareVersion: device.firmwareVersion,
      metadata: (device.metadata as Record<string, unknown> | null) ?? null,
      status: device.status as BusDeviceDto['status'],
      credentialSetAt: device.credentialSetAt?.toISOString() ?? null,
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      installedAt: device.installedAt?.toISOString() ?? null,
      createdAt: device.createdAt.toISOString(),
      updatedAt: device.updatedAt.toISOString(),
    };
  }
}
