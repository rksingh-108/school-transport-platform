import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { STORAGE_PROVIDER } from '../storage/storage-provider.interface';

describe('HealthController', () => {
  it('liveness returns ok without touching any dependency', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: { $queryRaw: jest.fn() } },
        { provide: RedisService, useValue: { ping: jest.fn() } },
        { provide: STORAGE_PROVIDER, useValue: { isReachable: jest.fn() } },
      ],
    }).compile();

    const controller = moduleRef.get(HealthController);
    const result = controller.liveness();

    expect(result.status).toBe('ok');
    expect(typeof result.timestamp).toBe('string');
  });

  it('readiness reports down for a dependency that fails, up for those that succeed', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('connection refused')) };
    const redis = { ping: jest.fn().mockResolvedValue(true) };
    const storage = { isReachable: jest.fn().mockResolvedValue(true) };

    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: STORAGE_PROVIDER, useValue: storage },
      ],
    }).compile();

    const controller = moduleRef.get(HealthController);

    await expect(controller.readiness()).rejects.toBeDefined();
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(redis.ping).toHaveBeenCalled();
    expect(storage.isReachable).toHaveBeenCalled();
  });
});
