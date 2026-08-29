import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates a request payload against a Zod schema from
 * @school-transport/shared-schemas — the same schema apps/web uses for form
 * validation, so the two can never drift. See
 * docs/architecture.md#3-cross-cutting-concerns.
 *
 * Usage: `@Body(new ZodValidationPipe(staffLoginSchema)) body: StaffLoginInput`
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed.',
        details: result.error.flatten(),
      });
    }
    return result.data;
  }
}
