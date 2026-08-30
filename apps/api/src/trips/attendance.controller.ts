import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  recordAttendanceSchema,
  correctAttendanceSchema,
  type RecordAttendanceInput,
  type CorrectAttendanceInput,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { AttendanceService } from './attendance.service';

/**
 * Reuses `attendance.read`/`attendance.manage` — no new permission was
 * introduced. `BUS_ATTENDANT` holds `attendance.manage` scoped to "own trip
 * only" by the seeded matrix (docs/security.md §2.3/§5.5) — enforced inside
 * AttendanceService by checking the caller's own Attendant profile against
 * the trip's assigned attendant, not by the permission grant alone.
 */
@RequireAudience('STAFF')
@Controller()
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @RequirePermission('attendance.manage')
  @Post('trips/:tripId/students/:tripStudentId/board')
  @HttpCode(HttpStatus.OK)
  async board(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('tripId') tripId: string,
    @Param('tripStudentId') tripStudentId: string,
    @Body(new ZodValidationPipe(recordAttendanceSchema)) body: RecordAttendanceInput,
    @Req() req: Request,
  ) {
    return this.attendanceService.board(principal, tripId, tripStudentId, body, this.metaFrom(req));
  }

  @RequirePermission('attendance.manage')
  @Post('trips/:tripId/students/:tripStudentId/dropoff')
  @HttpCode(HttpStatus.OK)
  async dropOff(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('tripId') tripId: string,
    @Param('tripStudentId') tripStudentId: string,
    @Body(new ZodValidationPipe(recordAttendanceSchema)) body: RecordAttendanceInput,
    @Req() req: Request,
  ) {
    return this.attendanceService.dropOff(principal, tripId, tripStudentId, body, this.metaFrom(req));
  }

  @RequirePermission('attendance.manage')
  @Post('trips/:tripId/students/:tripStudentId/absent')
  @HttpCode(HttpStatus.OK)
  async markAbsent(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('tripId') tripId: string,
    @Param('tripStudentId') tripStudentId: string,
    @Body(new ZodValidationPipe(recordAttendanceSchema)) body: RecordAttendanceInput,
    @Req() req: Request,
  ) {
    return this.attendanceService.markAbsent(principal, tripId, tripStudentId, body, this.metaFrom(req));
  }

  @RequirePermission('attendance.manage')
  @Post('trips/:tripId/students/:tripStudentId/attendance/:eventId/correct')
  @HttpCode(HttpStatus.OK)
  async correct(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('tripId') tripId: string,
    @Param('tripStudentId') tripStudentId: string,
    @Param('eventId') eventId: string,
    @Body(new ZodValidationPipe(correctAttendanceSchema)) body: CorrectAttendanceInput,
    @Req() req: Request,
  ) {
    return this.attendanceService.correct(principal, tripId, tripStudentId, eventId, body, this.metaFrom(req));
  }

  @RequirePermission('attendance.read')
  @Get('trips/:tripId/students/:tripStudentId/attendance')
  async history(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('tripId') tripId: string,
    @Param('tripStudentId') tripStudentId: string,
  ) {
    return this.attendanceService.history(principal, tripId, tripStudentId);
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
