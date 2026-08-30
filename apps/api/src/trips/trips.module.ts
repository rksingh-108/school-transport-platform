import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { TripStudentsController } from './trip-students.controller';
import { TripStudentsService } from './trip-students.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [AuthModule],
  controllers: [TripsController, TripStudentsController, AttendanceController],
  providers: [TripsService, TripStudentsService, AttendanceService],
})
export class TripsModule {}
