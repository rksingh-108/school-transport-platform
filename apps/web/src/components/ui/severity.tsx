import { AlertOctagon, AlertTriangle, Info, CircleDashed } from 'lucide-react';
import { Badge, type Tone } from './badge';
import { cn } from '@/lib/cn';

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

const SEVERITY_CONFIG: Record<Severity, { tone: Tone; icon: typeof AlertOctagon }> = {
  CRITICAL: { tone: 'danger', icon: AlertOctagon },
  HIGH: { tone: 'warning', icon: AlertTriangle },
  MEDIUM: { tone: 'info', icon: Info },
  LOW: { tone: 'neutral', icon: CircleDashed },
};

export function SeverityBadge({ severity, dot }: { severity: string; dot?: boolean }) {
  const config = SEVERITY_CONFIG[severity as Severity] ?? { tone: 'neutral' as Tone, icon: CircleDashed };
  const Icon = config.icon;
  return (
    <Badge tone={config.tone} dot={dot}>
      <Icon className="h-3 w-3" />
      {severity.replaceAll('_', ' ')}
    </Badge>
  );
}

/** A 4-segment scale showing where a severity sits — used on detail pages. */
export function SeverityMeter({ severity, className }: { severity: string; className?: string }) {
  const levels: Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  const activeIndex = levels.indexOf(severity as Severity);
  const fill = (i: number) => (i <= activeIndex ? 'bg-(--color-danger-solid)' : 'bg-(--color-neutral-border)');
  return (
    <div className={cn('flex items-center gap-1.5', className)} aria-label={`Severity: ${severity}`}>
      {levels.map((level, i) => (
        <span key={level} className={cn('h-1.5 flex-1 rounded-full transition-colors', fill(i))} />
      ))}
      <span className="ml-1 text-xs font-medium text-(--color-text-muted)">{severity}</span>
    </div>
  );
}