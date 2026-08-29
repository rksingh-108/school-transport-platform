/**
 * Mirrors the Prisma enums of the same name (see prisma/schema.prisma). Kept as
 * hand-written literal unions here so apps/web can use them without depending on
 * @prisma/client. If these ever drift from the Prisma schema, the Prisma-side
 * enum is the source of truth — update this file to match.
 */

export const TRIP_STUDENT_STATUSES = [
  'EXPECTED',
  'BOARDING_PENDING',
  'BOARDED',
  'ABSENT',
  'DROPPED_OFF',
  'ARRIVED_AT_SCHOOL',
] as const;
export type TripStudentStatus = (typeof TRIP_STUDENT_STATUSES)[number];

export const ATTENDANCE_EVENT_TYPES = [
  'BOARDING_CONFIRMED',
  'MARKED_ABSENT',
  'DROPPED_OFF',
  'ARRIVED_AT_SCHOOL',
  'STATUS_CORRECTED',
] as const;
export type AttendanceEventType = (typeof ATTENDANCE_EVENT_TYPES)[number];

export const ATTENDANCE_EVENT_SOURCES = ['ATTENDANT_APP', 'RFID', 'QR', 'CV', 'SYSTEM'] as const;
export type AttendanceEventSource = (typeof ATTENDANCE_EVENT_SOURCES)[number];

export const TRIP_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
