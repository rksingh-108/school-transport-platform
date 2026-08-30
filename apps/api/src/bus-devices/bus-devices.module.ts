import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BusDevicesController } from './bus-devices.controller';
import { BusDevicesService } from './bus-devices.service';

@Module({
  imports: [AuthModule],
  controllers: [BusDevicesController],
  providers: [BusDevicesService],
  // Phase 2 Step 11: CamerasService reuses rotateCredential() rather than
  // duplicating the credential generate/hash mechanism.
  exports: [BusDevicesService],
})
export class BusDevicesModule {}
