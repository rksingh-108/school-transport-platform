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
})
export class GpsModule {}
