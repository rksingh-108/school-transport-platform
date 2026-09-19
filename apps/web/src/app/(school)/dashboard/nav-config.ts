import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  GraduationCap,
  Users,
  UserRound,
  Bus,
  IdCard,
  UserCheck,
  Camera,
  Route as RouteIcon,
  CalendarClock,
  Satellite,
  Bell,
  ShieldAlert,
  Siren,
  MapPinned,
  ShieldCheck,
  ScanEye,
  ClipboardCheck,
  SlidersHorizontal,
  BarChart3,
} from 'lucide-react';
import type { PermissionKey } from '@school-transport/shared-types';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: PermissionKey | null;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ href: '/dashboard', label: 'Overview', icon: LayoutDashboard, permission: null }],
  },
  {
    label: 'People',
    items: [
      { href: '/dashboard/students', label: 'Students', icon: GraduationCap, permission: 'students.read' },
      { href: '/dashboard/staff', label: 'Staff', icon: Users, permission: 'users.read' },
      { href: '/dashboard/parents', label: 'Parents', icon: UserRound, permission: 'parents.read' },
    ],
  },
  {
    label: 'Fleet',
    items: [
      { href: '/dashboard/buses', label: 'Buses', icon: Bus, permission: 'buses.read' },
      { href: '/dashboard/drivers', label: 'Drivers', icon: IdCard, permission: 'drivers.read' },
      { href: '/dashboard/attendants', label: 'Attendants', icon: UserCheck, permission: 'attendants.read' },
      { href: '/dashboard/cameras', label: 'Cameras', icon: Camera, permission: 'camera.read' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/dashboard/routes', label: 'Routes', icon: RouteIcon, permission: 'routes.read' },
      { href: '/dashboard/trips', label: 'Trips', icon: CalendarClock, permission: 'trips.read' },
      { href: '/dashboard/live', label: 'Live Tracking', icon: Satellite, permission: 'gps.read' },
      { href: '/dashboard/notifications', label: 'Alerts', icon: Bell, permission: 'notifications.read' },
    ],
  },
  {
    label: 'Safety',
    items: [
      { href: '/dashboard/safety-events', label: 'Safety Events', icon: ShieldAlert, permission: 'safety_events.read' },
      { href: '/dashboard/emergencies', label: 'Emergencies', icon: Siren, permission: 'emergency.read' },
      { href: '/dashboard/geofences', label: 'Geofences', icon: MapPinned, permission: 'geofences.read' },
      { href: '/dashboard/safety-rules', label: 'Safety Rules', icon: ShieldCheck, permission: 'safety_rules.read' },
    ],
  },
  {
    label: 'AI & Analytics',
    items: [
      { href: '/dashboard/ai-observations', label: 'AI Observations', icon: ScanEye, permission: 'ai_events.read' },
      { href: '/dashboard/ai-review', label: 'AI Review', icon: ClipboardCheck, permission: 'ai_events.review' },
      { href: '/dashboard/ai-safety-policies', label: 'AI Safety Policies', icon: SlidersHorizontal, permission: 'ai_safety_policies.read' },
      { href: '/dashboard/safety-analytics', label: 'Safety Analytics', icon: BarChart3, permission: 'safety_analytics.read' },
    ],
  },
];

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
}
