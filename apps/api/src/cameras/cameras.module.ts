import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { BusDevicesModule } from '../bus-devices/bus-devices.module';
import type { Env } from '../config/env.schema';
import { CamerasController } from './cameras.controller';
import { CameraDevicesController } from './camera-devices.controller';
import { CamerasService } from './cameras.service';
import { CameraDeviceAuthGuard } from './guards/camera-device-auth.guard';
import {
  CAMERA_STREAM_PROVIDER,
  MockCameraStreamProvider,
  NotConfiguredCameraStreamProvider,
} from './providers/camera-stream.provider';

@Module({
  imports: [AuthModule, BusDevicesModule],
  controllers: [CamerasController, CameraDevicesController],
  providers: [
    CamerasService,
    CameraDeviceAuthGuard,
    {
      provide: CAMERA_STREAM_PROVIDER,
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('CAMERA_STREAM_PROVIDER', { infer: true }) === 'MOCK'
          ? new MockCameraStreamProvider()
          : new NotConfiguredCameraStreamProvider(),
      inject: [ConfigService],
    },
  ],
})
export class CamerasModule {}
