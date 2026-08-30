import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import type { Env } from '../config/env.schema';
import { AiObservationsController } from './ai-observations.controller';
import { EdgeAiController } from './edge-ai.controller';
import { AiModelsController } from './ai-models.controller';
import { AiObservationsService } from './ai-observations.service';
import { AiModelsService } from './ai-models.service';
import { AiObservationsGateway } from './ai-observations.gateway';
import { EdgeAiDeviceAuthGuard } from './guards/edge-ai-device-auth.guard';
import {
  COMPUTER_VISION_PROVIDER,
  MockComputerVisionProvider,
  NotConfiguredComputerVisionProvider,
} from './providers/computer-vision.provider';

@Module({
  imports: [AuthModule],
  controllers: [AiObservationsController, EdgeAiController, AiModelsController],
  providers: [
    AiObservationsService,
    AiModelsService,
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
