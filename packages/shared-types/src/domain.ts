import type { RoleKey } from './rbac';

/** Response DTOs — hand-shaped, never a serialized Prisma entity (docs/security.md#5). */

export interface SchoolDto {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'TRIAL' | 'SUSPENDED' | 'INACTIVE';
  contactEmail: string;
  contactPhone: string | null;
  address: Record<string, unknown> | null;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

export interface StaffDto {
  id: string;
  email: string;
  fullName: string;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'DISABLED';
  roles: RoleKey[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface InvitationDto {
  id: string;
  principalType: 'STAFF' | 'PARENT';
  email: string | null;
  fullName: string;
  invitedByName: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface StudentDto {
  id: string;
  admissionNumber: string;
  fullName: string;
  dateOfBirth: string | null;
  grade: string | null;
  section: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'GRADUATED';
  createdAt: string;
}

export interface ParentDto {
  id: string;
  phone: string;
  email: string | null;
  fullName: string;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'DISABLED';
  createdAt: string;
}

export interface ParentStudentLinkDto {
  id: string;
  studentId: string;
  studentFullName: string;
  relationship: string;
  verified: boolean;
  verifiedAt: string | null;
  createdAt: string;
}

/** Parent-facing shape of their own linked child — never includes school-internal fields. */
export interface ParentLinkedChildDto {
  id: string;
  fullName: string;
  grade: string | null;
  section: string | null;
}
