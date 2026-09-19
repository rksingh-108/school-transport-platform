'use client';

import Link from 'next/link';
import {
  ShieldAlert,
  Siren,
  ClipboardCheck,
  Bell,
  Satellite,
  ArrowRight,
  GraduationCap,
  Users,
  UserRound,
  Bus as BusIcon,
  IdCard,
  UserCheck,
  Camera,
  MapPinned,
  ShieldCheck,
  ScanEye,
  CalendarClock,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { getSafetyAnalytics } from '@/lib/api/safety-analytics';
import { getStaffUnreadCount } from '@/lib/api/notifications';
import { getFleetLocations } from '@/lib/api/gps';
import { listEmergencies } from '@/lib/api/emergencies';
import { listAiObservations } from '@/lib/api/ai-observations';
import { listTrips } from '@/lib/api/trips';
import { listSafetyEvents } from '@/lib/api/safety-events';
import { listStudents } from '@/lib/api/students';
import { listStaff } from '@/lib/api/staff';
import { listParents } from '@/lib/api/parents';
import { listBuses } from '@/lib/api/buses';
import { listDrivers } from '@/lib/api/drivers';
import { listAttendants } from '@/lib/api/attendants';
import { listCameras } from '@/lib/api/cameras';
import { listGeofences } from '@/lib/api/geofences';
import { listSafetyRules } from '@/lib/api/safety-rules';
import { StatCard } from '@/components/ui/stat-card';
import { CardSkeleton, StatCardSkeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import type { StaffMeResponse } from '@school-transport/shared-types';

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function DashboardOverviewPage() {
  const { principal } = useAuth();

  if (!principal || principal.type !== 'STAFF') return null;
  return <Overview principal={principal} />;
}

function Overview({ principal }: { principal: StaffMeResponse }) {
  const can = (perm: string) => principal.permissions.includes(perm);

  const canSafety = can('safety_events.read');
  const canEmergency = can('emergency.read');
  const canAiReview = can('ai_events.review');
  const canAlerts = can('notifications.read');
  const canGps = can('gps.read');
  const canTrips = can('trips.read');
  const canAiRead = can('ai_events.read');

  const { data: analytics, loading: analyticsLoading } = useAsync(
    () => (canSafety ? getSafetyAnalytics({ from: isoDaysAgo(30), to: new Date().toISOString() }) : Promise.resolve(null)),
    [canSafety],
  );
  const { data: unread, loading: unreadLoading } = useAsync(
    () => (canAlerts ? getStaffUnreadCount() : Promise.resolve(null)),
    [canAlerts],
  );
  const { data: fleet, loading: fleetLoading } = useAsync(
    () => (canGps ? getFleetLocations() : Promise.resolve(null)),
    [canGps],
  );
  const { data: activeEmergencies, loading: emergenciesLoading } = useAsync(
    () => (canEmergency ? listEmergencies({ status: 'ACTIVE', limit: 50 }) : Promise.resolve(null)),
    [canEmergency],
  );
  const { data: reviewQueue, loading: reviewLoading } = useAsync(
    () => (canAiReview ? listAiObservations({ status: 'CANDIDATE', limit: 50 }) : Promise.resolve(null)),
    [canAiReview],
  );
  const { data: todaysTrips, loading: tripsLoading } = useAsync(
    () => (canTrips ? listTrips({ serviceDate: todayDate(), limit: 50 }) : Promise.resolve(null)),
    [canTrips],
  );
  const { data: recentEvents, loading: eventsLoading } = useAsync(
    () => (canSafety ? listSafetyEvents({ limit: 5 }) : Promise.resolve(null)),
    [canSafety],
  );
  const { data: recentAi, loading: aiLoading } = useAsync(
    () => (canAiRead ? listAiObservations({ limit: 5 }) : Promise.resolve(null)),
    [canAiRead],
  );

  // Counts across the school — one batched, fault-tolerant request so a slow
  // endpoint can never hold up the whole overview.
  const countFlags = {
    students: can('students.read'),
    staff: can('users.read'),
    parents: can('parents.read'),
    buses: can('buses.read'),
    drivers: can('drivers.read'),
    attendants: can('attendants.read'),
    cameras: can('camera.read'),
    geofences: can('geofences.read'),
    safetyRules: can('safety_rules.read'),
  };
  const countsKey = JSON.stringify(countFlags);
  const { data: counts, loading: countsLoading } = useAsync(
    async () => {
      const jobs: Array<[keyof typeof countFlags, Promise<{ data: unknown[]; nextCursor: string | null }>]> = [];
      if (countFlags.students) jobs.push(['students', listStudents({ limit: 100 })]);
      if (countFlags.staff) jobs.push(['staff', listStaff({ limit: 100 })]);
      if (countFlags.parents) jobs.push(['parents', listParents({ limit: 100 })]);
      if (countFlags.buses) jobs.push(['buses', listBuses({ limit: 100 })]);
      if (countFlags.drivers) jobs.push(['drivers', listDrivers({ limit: 100 })]);
      if (countFlags.attendants) jobs.push(['attendants', listAttendants({ limit: 100 })]);
      if (countFlags.cameras) jobs.push(['cameras', listCameras({ limit: 100 })]);
      if (countFlags.geofences) jobs.push(['geofences', listGeofences({ limit: 100 })]);
      if (countFlags.safetyRules) jobs.push(['safetyRules', listSafetyRules({ limit: 100 })]);
      const settled = await Promise.allSettled(jobs.map(([, p]) => p));
      const result: Partial<Record<keyof typeof countFlags, { count: number; truncated: boolean }>> = {};
      jobs.forEach(([key], i) => {
        const r = settled[i];
        if (r.status === 'fulfilled') {
          result[key] = { count: r.value.data.length, truncated: !!r.value.nextCursor };
        }
      });
      return result;
    },
    [countsKey],
  );

  const fleetCounts = fleet?.reduce(
    (acc, b) => {
      acc[b.freshness] = (acc[b.freshness] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const liveCount = fleetCounts?.LIVE ?? 0;
  const staleCount = fleetCounts?.STALE ?? 0;
  const unknownCount = fleetCounts?.UNKNOWN ?? 0;
  const fleetTotal = liveCount + staleCount + unknownCount;
  const availability = fleetTotal > 0 ? Math.round((liveCount / fleetTotal) * 100) : null;

  const trips = todaysTrips?.data ?? [];
  const tripStatusCounts = trips.reduce(
    (acc, t) => {
      acc[t.status] = (acc[t.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const tripsInProgress = tripStatusCounts.IN_PROGRESS ?? 0;
  const studentsOnTrips = trips.reduce((sum, t) => sum + t.studentCount, 0);

  const hasActiveEmergency = (activeEmergencies?.data.length ?? 0) > 0;
  const earliestEmergencyStart = hasActiveEmergency
    ? activeEmergencies!.data.reduce<string | null>((min, e) => (min === null || e.startedAt < min ? e.startedAt : min), null)
    : null;

  const headlineTone = (value: number, whenTrue: boolean): 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand' =>
    whenTrue ? 'danger' : 'neutral';

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-(--radius-lg) bg-(--color-brand-panel) p-6 text-white shadow-(--shadow-sm) sm:p-7">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-(--color-brand) opacity-25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-32 h-48 w-48 rounded-full bg-(--color-info-solid) opacity-10 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-white/50">
              {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Good {dayPeriod()}, {firstName(principal.fullName)}</h1>
            <p className="mt-1 text-sm text-white/60">
              {principal.school.name} · {principal.roles.join(', ').replaceAll('_', ' ')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <HeroLink href="/dashboard/live" label="Live tracking" show={canGps} />
            <HeroLink href="/dashboard/emergencies" label="Emergencies" show={canEmergency} />
            <HeroLink href="/dashboard/ai-review" label="AI review" show={canAiReview} />
          </div>
        </div>
      </div>

      {hasActiveEmergency && (
        <Link
          href="/dashboard/emergencies"
          className="group flex items-center gap-3 rounded-(--radius-lg) border border-(--color-danger-border) bg-(--color-danger-bg) p-4 text-(--color-danger-text) transition-all duration-150 hover:shadow-(--shadow-md)"
        >
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-(--color-danger-solid) opacity-30" />
            <Siren className="relative h-5 w-5" />
          </span>
          <p className="flex-1 text-sm font-medium">
            {activeEmergencies!.data.length} active emergenc{activeEmergencies!.data.length === 1 ? 'y' : 'ies'} — response in progress
            {earliestEmergencyStart && <span className="ml-1.5 text-(--color-danger-text)/70">(first started {relativeTime(earliestEmergencyStart)})</span>}
          </p>
          <span className="text-xs font-medium underline-offset-2 group-hover:underline">Open command view</span>
          <ArrowRight className="h-4 w-4 shrink-0 transition-transform duration-150 group-hover:translate-x-1" />
        </Link>
      )}

      {/* Fleet status strip */}
      <Card>
        <CardBody className="p-0">
          <div className="grid grid-cols-2 divide-y divide-(--color-border) sm:grid-cols-4 sm:divide-x sm:divide-y-0">
            <FleetSegment
              label="Buses live"
              value={liveCount}
              dot="bg-(--color-success-solid)"
              sub={availability !== null ? `${availability}% of fleet reporting` : 'No fleet data'}
              href="/dashboard/live"
              loading={fleetLoading}
            />
            <FleetSegment label="Stale" value={staleCount} dot="bg-(--color-warning-solid)" sub="GPS older than threshold" href="/dashboard/live" loading={fleetLoading} />
            <FleetSegment label="Offline / unknown" value={unknownCount} dot="bg-(--color-neutral-solid)" sub="No recent fix" href="/dashboard/live" loading={fleetLoading} />
            <FleetSegment
              label="Trips in progress"
              value={tripsInProgress}
              dot="bg-(--color-brand)"
              sub={`${trips.length} trips today · ${studentsOnTrips} riders`}
              href="/dashboard/trips"
              loading={tripsLoading}
            />
          </div>
        </CardBody>
      </Card>

      {/* Headline stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {canSafety &&
          (analyticsLoading ? (
            <StatCardSkeleton />
          ) : (
            <StatCard
              label="Safety events (30d)"
              value={analytics?.summary.totalSafetyEvents ?? 0}
              icon={ShieldAlert}
              tone="warning"
              href="/dashboard/safety-events"
            />
          ))}
        {canEmergency &&
          (emergenciesLoading ? (
            <StatCardSkeleton />
          ) : (
            <StatCard
              label="Active emergencies"
              value={activeEmergencies?.data.length ?? 0}
              icon={Siren}
              tone={headlineTone(activeEmergencies?.data.length ?? 0, hasActiveEmergency)}
              href="/dashboard/emergencies"
            />
          ))}
        {canAiReview &&
          (reviewLoading ? (
            <StatCardSkeleton />
          ) : (
            <StatCard
              label="AI review queue"
              value={reviewQueue ? `${reviewQueue.data.length}${reviewQueue.nextCursor ? '+' : ''}` : 0}
              icon={ClipboardCheck}
              tone="info"
              href="/dashboard/ai-review"
            />
          ))}
        {canGps &&
          (fleetLoading ? (
            <StatCardSkeleton />
          ) : (
            <StatCard
              label="Buses live now"
              value={liveCount}
              sublabel={`${staleCount} stale · ${unknownCount} unknown`}
              icon={Satellite}
              tone={liveCount > 0 ? 'success' : 'neutral'}
              href="/dashboard/live"
            />
          ))}
        {canAlerts &&
          (unreadLoading ? (
            <StatCardSkeleton />
          ) : (
            <StatCard
              label="Unread alerts"
              value={unread?.count ?? 0}
              icon={Bell}
              tone={(unread?.count ?? 0) > 0 ? 'brand' : 'neutral'}
              href="/dashboard/notifications"
            />
          ))}
      </div>

      {/* School at a glance */}
      {countsLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        counts && (
          <Card>
            <CardHeader title="School at a glance" description="Live counts across people, fleet, and safety." />
            <CardBody className="p-0">
              <div className="grid grid-cols-2 gap-px bg-(--color-border) sm:grid-cols-3 xl:grid-cols-5">
                <GlanceCell icon={GraduationCap} label="Students" count={counts.students?.count} truncated={counts.students?.truncated} href="/dashboard/students" tone="text-(--color-brand-text) bg-(--color-brand-bg)" />
                <GlanceCell icon={Users} label="Staff" count={counts.staff?.count} truncated={counts.staff?.truncated} href="/dashboard/staff" tone="text-(--color-info-text) bg-(--color-info-bg)" />
                <GlanceCell icon={UserRound} label="Parents" count={counts.parents?.count} truncated={counts.parents?.truncated} href="/dashboard/parents" tone="text-(--color-success-text) bg-(--color-success-bg)" />
                <GlanceCell icon={BusIcon} label="Buses" count={counts.buses?.count} truncated={counts.buses?.truncated} href="/dashboard/buses" tone="text-(--color-warning-text) bg-(--color-warning-bg)" />
                <GlanceCell icon={IdCard} label="Drivers" count={counts.drivers?.count} truncated={counts.drivers?.truncated} href="/dashboard/drivers" tone="text-(--color-brand-text) bg-(--color-brand-bg)" />
                <GlanceCell icon={UserCheck} label="Attendants" count={counts.attendants?.count} truncated={counts.attendants?.truncated} href="/dashboard/attendants" tone="text-(--color-info-text) bg-(--color-info-bg)" />
                <GlanceCell icon={Camera} label="Cameras" count={counts.cameras?.count} truncated={counts.cameras?.truncated} href="/dashboard/cameras" tone="text-(--color-success-text) bg-(--color-success-bg)" />
                <GlanceCell icon={MapPinned} label="Geofences" count={counts.geofences?.count} truncated={counts.geofences?.truncated} href="/dashboard/geofences" tone="text-(--color-warning-text) bg-(--color-warning-bg)" />
                <GlanceCell icon={ShieldCheck} label="Safety rules" count={counts.safetyRules?.count} truncated={counts.safetyRules?.truncated} href="/dashboard/safety-rules" tone="text-(--color-danger-text) bg-(--color-danger-bg)" />
              </div>
            </CardBody>
          </Card>
        )
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Today's trips */}
        {canTrips && (
          <Card hoverable>
            <CardHeader
              title="Today's trips"
              description={`${trips.length} scheduled · ${studentsOnTrips} riders`}
              actions={
                <Link href="/dashboard/trips" className="text-sm text-(--color-brand-text) hover:underline">
                  View all
                </Link>
              }
            />
            <CardBody>
              {tripsLoading ? (
                <CardSkeleton lines={3} />
              ) : trips.length === 0 ? (
                <EmptyState title="No trips scheduled today" />
              ) : (
                <div className="space-y-4">
                  <TripStatusBar counts={tripStatusCounts} total={trips.length} />
                  <ul className="divide-y divide-(--color-border)">
                    {trips.slice(0, 5).map((trip) => (
                      <li key={trip.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <div className="min-w-0">
                          <Link href={`/dashboard/trips/${trip.id}`} className="block truncate font-medium text-(--color-text) hover:text-(--color-brand-text)">
                            {trip.routeName} · {trip.busRegistrationNumber}
                          </Link>
                          <p className="truncate text-xs text-(--color-text-faint)">
                            {trip.scheduledStartTime}–{trip.scheduledEndTime} · {trip.studentCount} riders
                          </p>
                        </div>
                        <StatusBadge status={trip.status} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {/* AI activity */}
        {canAiRead && (
          <Card hoverable>
            <CardHeader
              title="AI safety activity"
              description="Edge detections and human review status"
              actions={
                canAiReview ? (
                  <Link href="/dashboard/ai-review" className="text-sm text-(--color-brand-text) hover:underline">
                    Review queue
                  </Link>
                ) : undefined
              }
            />
            <CardBody>
              {aiLoading ? (
                <CardSkeleton lines={3} />
              ) : !recentAi || recentAi.data.length === 0 ? (
                <EmptyState title="No AI detections yet" description="Edge devices report here once they're onboarded." />
              ) : (
                <div className="space-y-4">
                  <ul className="divide-y divide-(--color-border)">
                    {recentAi.data.slice(0, 4).map((obs) => (
                      <li key={obs.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <div className="min-w-0">
                          <Link
                            href={`/dashboard/ai-observations/${obs.id}`}
                            className="flex items-center gap-1.5 truncate font-medium text-(--color-text) hover:text-(--color-brand-text)"
                          >
                            <ScanEye className="h-3.5 w-3.5 shrink-0 text-(--color-text-faint)" />
                            {obs.detectionType.replace(/_/g, ' ')}
                          </Link>
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="h-1 w-20 overflow-hidden rounded-full bg-(--color-neutral-bg)">
                              <div
                                className="h-full rounded-full bg-(--color-info-solid)"
                                style={{ width: `${Math.round(obs.confidence * 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-(--color-text-faint)">{Math.round(obs.confidence * 100)}% · {relativeTime(obs.occurredAt)}</span>
                          </div>
                        </div>
                        <StatusBadge status={obs.status} />
                      </li>
                    ))}
                  </ul>
                  {reviewQueue && reviewQueue.data.length > 0 && (
                    <Link
                      href="/dashboard/ai-review"
                      className="flex items-center justify-between rounded-(--radius-md) border border-(--color-info-border) bg-(--color-info-bg) px-3 py-2.5 text-sm text-(--color-info-text) transition-colors hover:bg-(--color-info-bg)/70"
                    >
                      <span className="font-medium">{reviewQueue.data.length} detection{reviewQueue.data.length === 1 ? '' : 's'} awaiting review</span>
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {/* Safety snapshot */}
        {canSafety && (
          <Card hoverable>
            <CardHeader
              title="Safety snapshot"
              description="Events, geofences, and rules at a glance"
              actions={
                <Link href="/dashboard/safety-analytics" className="text-sm text-(--color-brand-text) hover:underline">
                  Analytics
                </Link>
              }
            />
            <CardBody>
              {eventsLoading ? (
                <CardSkeleton lines={3} />
              ) : !recentEvents || recentEvents.data.length === 0 ? (
                <EmptyState title="No safety events recorded" />
              ) : (
                <ul className="divide-y divide-(--color-border)">
                  {recentEvents.data.map((event) => (
                    <li key={event.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <Link href={`/dashboard/safety-events/${event.id}`} className="min-w-0 truncate font-medium text-(--color-text) hover:text-(--color-brand-text)">
                        {event.type.replaceAll('_', ' ')}
                      </Link>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={event.severity} />
                        <StatusBadge status={event.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {(counts?.geofences || counts?.safetyRules) && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-(--color-border) pt-4">
                  {counts?.geofences && (
                    <Link
                      href="/dashboard/geofences"
                      className="inline-flex items-center gap-1.5 rounded-full bg-(--color-neutral-bg) px-3 py-1 text-xs font-medium text-(--color-neutral-text) transition-colors hover:bg-(--color-neutral-border)"
                    >
                      <MapPinned className="h-3.5 w-3.5" /> {counts.geofences.count} geofences{counts.geofences.truncated ? '+' : ''}
                    </Link>
                  )}
                  {counts?.safetyRules && (
                    <Link
                      href="/dashboard/safety-rules"
                      className="inline-flex items-center gap-1.5 rounded-full bg-(--color-neutral-bg) px-3 py-1 text-xs font-medium text-(--color-neutral-text) transition-colors hover:bg-(--color-neutral-border)"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> {counts.safetyRules.count} rules{counts.safetyRules.truncated ? '+' : ''}
                    </Link>
                  )}
                  {analytics && (
                    <Link
                      href="/dashboard/safety-analytics"
                      className="inline-flex items-center gap-1.5 rounded-full bg-(--color-neutral-bg) px-3 py-1 text-xs font-medium text-(--color-neutral-text) transition-colors hover:bg-(--color-neutral-border)"
                    >
                      <CalendarClock className="h-3.5 w-3.5" /> {analytics.summary.totalEmergencies} emergencies (30d)
                    </Link>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

function dayPeriod(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function firstName(fullName: string): string {
  return fullName.split(' ')[0] ?? fullName;
}

function HeroLink({ href, label, show }: { href: string; label: string; show: boolean }) {
  if (!show) return null;
  return (
    <Link
      href={href}
      className="rounded-(--radius-sm) border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 transition-colors hover:bg-white/20"
    >
      {label}
    </Link>
  );
}

function FleetSegment({
  label,
  value,
  dot,
  sub,
  href,
  loading,
}: {
  label: string;
  value: number;
  dot: string;
  sub: string;
  href: string;
  loading: boolean;
}) {
  return (
    <Link href={href} className="group flex items-center gap-3 p-4 transition-colors hover:bg-(--color-surface-sunken)">
      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', dot, !loading && value > 0 && 'animate-pulse')} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">{label}</p>
        <p className="mt-0.5 text-xl font-semibold tracking-tight text-(--color-text)">{loading ? <SkeletonValue /> : value}</p>
        <p className="truncate text-xs text-(--color-text-faint)">{sub}</p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-(--color-text-faint) opacity-0 transition-all duration-150 group-hover:translate-x-0.5 group-hover:opacity-100" />
    </Link>
  );
}

function SkeletonValue() {
  return <span className="inline-block h-6 w-8 animate-pulse rounded-(--radius-sm) bg-(--color-neutral-bg)" />;
}

function GlanceCell({
  icon: Icon,
  label,
  count,
  truncated,
  href,
  tone,
}: {
  icon: typeof Users;
  label: string;
  count: number | undefined;
  truncated?: boolean;
  href: string;
  tone: string;
}) {
  return (
    <Link href={href} className="group flex items-center gap-3 bg-(--color-surface) p-4 transition-colors hover:bg-(--color-surface-sunken)">
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius-md)', tone)}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-tight tracking-tight text-(--color-text)">
          {count === undefined ? '—' : `${count}${truncated ? '+' : ''}`}
        </p>
        <p className="truncate text-xs text-(--color-text-faint)">{label}</p>
      </div>
    </Link>
  );
}

const TRIP_STATUS_ORDER = ['SCHEDULED', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;
const TRIP_STATUS_BAR: Record<string, string> = {
  SCHEDULED: 'bg-(--color-neutral-solid)',
  READY: 'bg-(--color-warning-solid)',
  IN_PROGRESS: 'bg-(--color-brand)',
  COMPLETED: 'bg-(--color-success-solid)',
  CANCELLED: 'bg-(--color-danger-solid)',
  NO_SHOW: 'bg-(--color-danger-solid)',
};

function TripStatusBar({ counts, total }: { counts: Record<string, number>; total: number }) {
  const segments = TRIP_STATUS_ORDER.filter((s) => (counts[s] ?? 0) > 0);
  return (
    <div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-(--color-neutral-bg)">
        {segments.map((s) => (
          <div key={s} className={cn('h-full', TRIP_STATUS_BAR[s])} style={{ width: `${((counts[s] ?? 0) / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {segments.map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-xs text-(--color-text-faint)">
            <span className={cn('h-1.5 w-1.5 rounded-full', TRIP_STATUS_BAR[s])} />
            <StatusBadge status={s} />
            <span>×{counts[s]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}