import { Module } from '@nestjs/common';
import { BusDevicesController } from './bus-devices.controller';
import { BusDevicesService } from './bus-devices.service';

@Module({
  controllers: [BusDevicesController],
  providers: [BusDevicesService],
})
export class BusDevicesModule {}
