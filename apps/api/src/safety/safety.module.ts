import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SafetyEventsController } from './safety-events.controller';
import { SafetyEventsService } from './safety-events.service';
import { EmergenciesController } from './emergencies.controller';
import { EmergenciesService } from './emergencies.service';
import { SafetyGateway } from './safety.gateway';

/**
 * One module for both SafetyEvent and Emergency (Phase 2 Step 12) — the two
 * are tightly coupled by design (escalation creates an Emergency from a
 * SafetyEvent; resolving that Emergency resolves the SafetyEvent back), so
 * splitting them into separate NestJS modules would just relocate the
 * circular dependency between services to a circular dependency between
 * modules, with no actual decoupling benefit. See
 * docs/adr/0019-safety-events-and-emergency-management.md.
 */
@Module({
  imports: [AuthModule],
  controllers: [SafetyEventsController, EmergenciesController],
  providers: [SafetyEventsService, EmergenciesService, SafetyGateway],
})
export class SafetyModule {}
