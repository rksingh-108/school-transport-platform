import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BusDevicesController } from './bus-devices.controller';
import { BusDevicesService } from './bus-devices.service';

@Module({
  imports: [AuthModule],
  controllers: [BusDevicesController],
  providers: [BusDevicesService],
})
export class BusDevicesModule {}
