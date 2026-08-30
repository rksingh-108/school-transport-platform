import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GpsController } from './gps.controller';
import { GpsIngestionController } from './gps-ingestion.controller';
import { GpsSimulatorController } from './gps-simulator.controller';
import { GpsService } from './gps.service';
import { GpsGateway } from './gps.gateway';
import { DeviceAuthGuard } from './guards/device-auth.guard';

@Module({
  imports: [AuthModule],
  controllers: [GpsController, GpsIngestionController, GpsSimulatorController],
  providers: [GpsService, GpsGateway, DeviceAuthGuard],
  // GpsService: consumed by ParentTransportService (Phase 1 Step 8) to
  // resolve a verified child's bus location. GpsGateway: consumed by
  // ParentGateway (same phase) via `onLocationUpdate`, so it can derive
  // parent-safe events without duplicating the current-location pipeline.
  exports: [GpsService, GpsGateway],
})
export class GpsModule {}
