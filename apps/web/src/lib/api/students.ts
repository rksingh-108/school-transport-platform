import type { CursorPage, StudentDto } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

export interface StudentListParams {
  limit?: number;
  cursor?: string;
  search?: string;
  grade?: string;
  section?: string;
  status?: string;
}

function toQuery(params: object): string {
  const entries = Object.entries(params as Record<string, string | number | undefined>).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
}

export async function listStudents(params: StudentListParams = {}): Promise<CursorPage<StudentDto>> {
  return apiFetch(`/students${toQuery(params)}`);
}

export async function getStudent(id: string): Promise<StudentDto> {
  return apiFetch(`/students/${id}`);
}

export interface StudentInput {
  admissionNumber: string;
  fullName: string;
  dateOfBirth?: string;
  grade?: string;
  section?: string;
}

export async function createStudent(input: StudentInput): Promise<StudentDto> {
  return apiFetch('/students', { method: 'POST', body: input });
}

export async function updateStudent(id: string, input: Partial<StudentInput>): Promise<StudentDto> {
  return apiFetch(`/students/${id}`, { method: 'PATCH', body: input });
}

export async function archiveStudent(id: string): Promise<StudentDto> {
  return apiFetch(`/students/${id}/archive`, { method: 'POST' });
}
