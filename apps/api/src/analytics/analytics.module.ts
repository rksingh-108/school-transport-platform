import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SafetyAnalyticsController } from './safety-analytics.controller';
import { SafetyAnalyticsService } from './safety-analytics.service';

@Module({
  imports: [AuthModule],
  controllers: [SafetyAnalyticsController],
  providers: [SafetyAnalyticsService],
})
export class AnalyticsModule {}
