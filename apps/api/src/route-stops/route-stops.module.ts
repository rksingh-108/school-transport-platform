import { Module } from '@nestjs/common';
import { RouteStopsController } from './route-stops.controller';
import { RouteStopsService } from './route-stops.service';

@Module({
  controllers: [RouteStopsController],
  providers: [RouteStopsService],
})
export class RouteStopsModule {}
