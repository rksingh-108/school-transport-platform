import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { SafetyModule } from '../safety/safety.module';
import type { Env } from '../config/env.schema';
import { AiObservationsController } from './ai-observations.controller';
import { EdgeAiController } from './edge-ai.controller';
import { AiModelsController } from './ai-models.controller';
import { AiSafetyPoliciesController } from './ai-safety-policies.controller';
import { AiObservationsService } from './ai-observations.service';
import { AiModelsService } from './ai-models.service';
import { AiSafetyPoliciesService } from './ai-safety-policies.service';
import { AiObservationsGateway } from './ai-observations.gateway';
import { EdgeAiDeviceAuthGuard } from './guards/edge-ai-device-auth.guard';
import {
  COMPUTER_VISION_PROVIDER,
  MockComputerVisionProvider,
  NotConfiguredComputerVisionProvider,
} from './providers/computer-vision.provider';

@Module({
  // SafetyModule: AiObservationsService.promote() calls
  // SafetyEventsService.createRowFromAiObservation()/afterAiPromotion() —
  // AI-observation review produces a SafetyEvent, it does not own that
  // model (see docs/adr/0022-ai-observation-review-and-safety-analytics.md).
  imports: [AuthModule, SafetyModule],
  controllers: [AiObservationsController, EdgeAiController, AiModelsController, AiSafetyPoliciesController],
  providers: [
    AiObservationsService,
    AiModelsService,
    AiSafetyPoliciesService,
    AiObservationsGateway,
    EdgeAiDeviceAuthGuard,
    {
      provide: COMPUTER_VISION_PROVIDER,
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('AI_INFERENCE_PROVIDER', { infer: true }) === 'MOCK'
          ? new MockComputerVisionProvider()
          : new NotConfiguredComputerVisionProvider(),
      inject: [ConfigService],
    },
  ],
})
export class AiObservationsModule {}
