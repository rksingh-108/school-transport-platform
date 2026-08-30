import { z } from 'zod';

export const BUS_STATUSES = ['ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED'] as const;
/** Settable via PATCH — excludes RETIRED, which is only ever set by POST /buses/:id/archive (see docs/security.md). */
const patchableBusStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE']);

const currentYear = new Date().getFullYear();

/**
 * Deliberately has no `schoolId` field — a bus's tenant is fixed at creation
 * from the caller's own authenticated context and can never be supplied or
 * changed through this endpoint, same structural tenant lock as students.
 */
export const createBusSchema = z.object({
  fleetNumber: z.string().max(50).optional(),
  registrationNumber: z.string().min(1).max(50),
  capacity: z.coerce.number().int().min(1).max(200),
  make: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  manufactureYear: z.coerce.number().int().min(1980).max(currentYear + 1).optional(),
  permitExpiry: z.string().date().optional(),
  insuranceExpiry: z.string().date().optional(),
  fitnessExpiry: z.string().date().optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateBusInput = z.infer<typeof createBusSchema>;

export const updateBusSchema = z.object({
  fleetNumber: z.string().max(50).optional(),
  registrationNumber: z.string().min(1).max(50).optional(),
  capacity: z.coerce.number().int().min(1).max(200).optional(),
  make: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  manufactureYear: z.coerce.number().int().min(1980).max(currentYear + 1).optional(),
  status: patchableBusStatusSchema.optional(),
  permitExpiry: z.string().date().optional(),
  insuranceExpiry: z.string().date().optional(),
  fitnessExpiry: z.string().date().optional(),
  notes: z.string().max(2000).optional(),
});
export type UpdateBusInput = z.infer<typeof updateBusSchema>;

export const listBusesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  status: z.enum(BUS_STATUSES).optional(),
  minCapacity: z.coerce.number().int().min(1).optional(),
});
export type ListBusesQuery = z.infer<typeof listBusesQuerySchema>;
