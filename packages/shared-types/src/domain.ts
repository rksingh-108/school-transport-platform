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

export interface BusDto {
  id: string;
  fleetNumber: string | null;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  manufactureYear: number | null;
  capacity: number;
  status: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' | 'RETIRED';
  permitExpiry: string | null;
  insuranceExpiry: string | null;
  fitnessExpiry: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A transport-specific profile layered onto an existing staff User — never a duplicate identity. */
export interface DriverDto {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  licenseNumber: string;
  licenseExpiry: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface AttendantDto {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

/** Never includes a device secret/credential — no such field exists on this model yet; see docs/security.md#device-security. */
export interface BusDeviceDto {
  id: string;
  busId: string;
  deviceType: 'GPS_TRACKER' | 'EDGE_COMPUTER' | 'NETWORK_GATEWAY';
  externalDeviceId: string;
  firmwareVersion: string | null;
  metadata: Record<string, unknown> | null;
  status: 'ACTIVE' | 'INACTIVE' | 'FAULTY';
  lastSeenAt: string | null;
  installedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A reusable planned path — never a specific day's execution (that's the future Trip). See docs/database.md §8. */
export interface RouteDto {
  id: string;
  code: string | null;
  name: string;
  direction: 'HOME_TO_SCHOOL' | 'SCHOOL_TO_HOME';
  shift: 'MORNING_PICKUP' | 'AFTERNOON_DROP' | 'CUSTOM';
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  description: string | null;
  stopCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RouteStopDto {
  id: string;
  routeId: string;
  sequenceNo: number;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  expectedOffsetMinutes: number;
  radiusMeters: number;
  mode: 'PICKUP' | 'DROPOFF' | 'BOTH';
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}
