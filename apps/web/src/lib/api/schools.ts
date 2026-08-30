import type { SchoolDto } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

export async function getSchool(id: string): Promise<SchoolDto> {
  return apiFetch(`/schools/${id}`);
}

export interface UpdateSchoolInput {
  name?: string;
  contactEmail?: string;
  contactPhone?: string;
  timezone?: string;
}

export async function updateSchool(id: string, input: UpdateSchoolInput): Promise<SchoolDto> {
  return apiFetch(`/schools/${id}`, { method: 'PATCH', body: input });
}
