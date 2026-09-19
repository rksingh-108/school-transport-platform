'use client';

import { Check, UserX } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ParentAttendanceStatus, ParentTripStatus } from '@school-transport/shared-types';

/**
 * Visual progress through today's trip for one child:
 * Not yet boarded → Boarded → Dropped off.
 * Pure presentation over real API state — never invents a status.
 */
export function BoardingStepper({
  attendanceStatus,
  tripStatus,
}: {
  attendanceStatus: ParentAttendanceStatus | null;
  tripStatus: ParentTripStatus | null;
}) {
  if (!tripStatus) return null;

  if (tripStatus === 'CANCELLED' || tripStatus === 'NO_SHOW') {
    return (
      <p className="text-xs font-medium text-(--color-danger-text)">
        {tripStatus === 'CANCELLED' ? "Today's trip was cancelled" : 'Marked as no-show'}
      </p>
    );
  }

  if (tripStatus === 'COMPLETED' && attendanceStatus !== 'DROPPED_OFF' && attendanceStatus !== 'BOARDED') {
    return <p className="text-xs font-medium text-(--color-text-faint)">Trip completed</p>;
  }

  const stage = attendanceStatus === 'DROPPED_OFF' ? 3 : attendanceStatus === 'BOARDED' ? 2 : 1;
  const isAbsent = attendanceStatus === 'ABSENT';
  const steps = [
    { label: 'Not yet boarded', key: 1 },
    { label: 'Boarded', key: 2 },
    { label: 'Dropped off', key: 3 },
  ];

  return (
    <div className="flex items-start" aria-label={`Boarding status: ${steps[stage - 1].label}`}>
      {steps.map((step, i) => {
        const complete = !isAbsent && stage > step.key;
        const current = !isAbsent && stage === step.key;
        const isLast = i === steps.length - 1;
        return (
          <div key={step.key} className={cn('flex items-start', !isLast && 'flex-1')}>
            <div className="flex flex-col items-center gap-1">
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                  complete && 'bg-(--color-success-solid) text-white',
                  current && 'bg-(--color-brand) text-white ring-4 ring-(--color-brand-bg)',
                  !complete && !current && 'bg-(--color-neutral-bg) text-(--color-text-faint)',
                )}
              >
                {complete ? <Check className="h-3.5 w-3.5" /> : isAbsent && step.key === 1 ? <UserX className="h-3.5 w-3.5 text-(--color-danger-text)" /> : step.key}
              </span>
            </div>
            <div className="mt-1.5 ml-1.5 text-[11px] leading-tight">
              <p className={cn('font-medium', complete || current ? 'text-(--color-text)' : 'text-(--color-text-faint)')}>{step.label}</p>
              {isAbsent && step.key === 1 && <p className="text-[10px] font-medium text-(--color-danger-text)">Marked absent</p>}
            </div>
            {!isLast && (
              <span className={cn('mx-1.5 mt-3.5 h-0.5 min-w-4 flex-1 rounded-full', complete ? 'bg-(--color-success-solid)' : 'bg-(--color-neutral-border)')} />
            )}
          </div>
        );
      })}
    </div>
  );
}