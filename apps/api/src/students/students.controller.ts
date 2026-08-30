import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createStudentSchema,
  updateStudentSchema,
  listStudentsQuerySchema,
  type CreateStudentInput,
  type UpdateStudentInput,
  type ListStudentsQuery,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { StudentsService } from './students.service';

@RequireAudience('STAFF')
@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @RequirePermission('students.read')
  @Get()
  async list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(listStudentsQuerySchema)) query: ListStudentsQuery,
  ) {
    return this.studentsService.list(principal, query);
  }

  @RequirePermission('students.read')
  @Get(':id')
  async get(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.studentsService.get(principal, id);
  }

  @RequirePermission('students.create')
  @Post()
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(createStudentSchema)) body: CreateStudentInput,
    @Req() req: Request,
  ) {
    return this.studentsService.create(principal, body, this.metaFrom(req));
  }

  @RequirePermission('students.update')
  @Patch(':id')
  async update(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateStudentSchema)) body: UpdateStudentInput,
    @Req() req: Request,
  ) {
    return this.studentsService.update(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('students.delete')
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.studentsService.archive(principal, id, this.metaFrom(req));
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
