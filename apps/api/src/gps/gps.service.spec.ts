import { ForbiddenException } from '@nestjs/common';
import { GpsService } from './gps.service';

/**
 * Phase 1 Step 10 hardening: the dev-only GPS simulator
 * (`GpsSimulatorController` → `GpsService.simulateIngest`) must be
 * impossible in production regardless of who calls it — this is the
 * primary safeguard (the controller's `buses.manage` gate is defense in
 * depth on top of it), and had no regression test at all before this audit
 * despite being asserted throughout docs/roadmap.md and docs/adr/0014.
 * Only this one guard clause is under test — every other dependency is a
 * bare stub since the method returns before touching any of them.
 */
describe('GpsService.simulateIngest — production lockout', () => {
  function makeService(nodeEnv: string): GpsService {
    const configStub = { get: (key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined) };
    return new GpsService(
      {} as never,
      {} as never,
      {} as never,
      configStub as never,
      {} as never,
      {} as never,
    );
  }

  it('refuses when NODE_ENV=production, before touching any dependency', async () => {
    const service = makeService('production');
    await expect(service.simulateIngest({ schoolId: 'school-1' } as never, 'bus-1', {} as never)).rejects.toThrow(ForbiddenException);
  });

  it('does not refuse for development/test (falls through to real dependency calls, which then fail loudly on the stubs — proving the guard did not short-circuit)', async () => {
    const service = makeService('development');
    // The stubbed PrismaService has no runInTenantContext method, so this
    // rejects for a DIFFERENT reason than ForbiddenException — confirming
    // the production guard specifically is what's absent here.
    await expect(service.simulateIngest({ schoolId: 'school-1' } as never, 'bus-1', {} as never)).rejects.not.toThrow(ForbiddenException);
  });
});
