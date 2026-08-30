import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SafetyModule } from '../safety/safety.module';
import { GeofencesController } from './geofences.controller';
import { GeofencesService } from './geofences.service';
import { SafetyRulesController } from './safety-rules.controller';
import { SafetyRulesService } from './safety-rules.service';
import { OperationalSafetyService } from './operational-safety.service';

/**
 * Geofences (places) + SafetyRules (monitoring policies) + the
 * deterministic rule-evaluation engine GpsModule calls into (Phase 2
 * Step 13). See docs/adr/0020-geofencing-and-operational-safety-rules.md.
 * Imports `SafetyModule` for `SafetyEventsService.createSystemEvent` —
 * geofencing produces SafetyEvents, it does not own that model.
 */
@Module({
  imports: [AuthModule, SafetyModule],
  controllers: [GeofencesController, SafetyRulesController],
  providers: [GeofencesService, SafetyRulesService, OperationalSafetyService],
  exports: [OperationalSafetyService],
})
export class GeofencingModule {}
