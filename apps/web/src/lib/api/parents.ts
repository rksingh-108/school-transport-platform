import type {
  CursorPage,
  ParentDto,
  ParentStudentLinkDto,
  ParentChildWithTransportDto,
  ParentTransportDto,
} from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

function toQuery(params: object): string {
  const entries = Object.entries(params as Record<string, string | number | undefined>).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
}

export interface ParentListParams {
  limit?: number;
  cursor?: string;
  search?: string;
}

export async function listParents(params: ParentListParams = {}): Promise<CursorPage<ParentDto>> {
  return apiFetch(`/parents${toQuery(params)}`);
}

export async function getParent(id: string): Promise<ParentDto> {
  return apiFetch(`/parents/${id}`);
}

export async function createParent(input: { phone: string; fullName: string; email?: string }): Promise<ParentDto> {
  return apiFetch('/parents', { method: 'POST', body: input });
}

export async function updateParent(id: string, input: { fullName?: string; email?: string }): Promise<ParentDto> {
  return apiFetch(`/parents/${id}`, { method: 'PATCH', body: input });
}

export async function listParentChildren(parentId: string): Promise<ParentStudentLinkDto[]> {
  return apiFetch(`/parents/${parentId}/children`);
}

export async function linkStudentToParent(
  parentId: string,
  input: { studentId: string; relationship?: string },
): Promise<ParentStudentLinkDto> {
  return apiFetch(`/parents/${parentId}/children`, { method: 'POST', body: input });
}

export async function verifyParentStudentLink(linkId: string): Promise<ParentStudentLinkDto> {
  return apiFetch(`/parent-students/${linkId}/verify`, { method: 'POST' });
}

export async function unlinkParentStudent(linkId: string): Promise<void> {
  await apiFetch(`/parent-students/${linkId}`, { method: 'DELETE' });
}

// Parent's own (self) view
export async function getMyChildren(): Promise<ParentChildWithTransportDto[]> {
  return apiFetch('/parent/children');
}

export async function getChildTransport(studentId: string): Promise<ParentTransportDto> {
  return apiFetch(`/parent/children/${studentId}/transport`);
}
