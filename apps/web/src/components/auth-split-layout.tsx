import type { ReactNode } from 'react';
import { Bus, MapPinned, ShieldCheck, Users } from 'lucide-react';

const HIGHLIGHTS = [
  { icon: Bus, text: 'Live fleet visibility across every route' },
  { icon: ShieldCheck, text: 'Human-reviewed safety events, always auditable' },
  { icon: Users, text: 'One platform for staff, drivers, and parents' },
  { icon: MapPinned, text: 'Route, stop, and trip management in one place' },
];

/** Shared branded shell for the staff and parent login pages. */
export function AuthSplitLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-(--color-surface-sunken)">
      <div className="relative hidden w-[42%] flex-col justify-between overflow-hidden bg-(--color-brand-panel) p-10 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-(--color-brand) opacity-20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-(--color-info-solid) opacity-10 blur-3xl" />

        <div className="relative flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-(--radius-sm) bg-[image:var(--gradient-brand)] text-white shadow-(--shadow-glow)">
            <Bus className="h-5 w-5" />
          </span>
          <span className="text-base font-semibold">School Transport Platform</span>
        </div>
        <div className="relative">
          <h1 className="max-w-sm text-3xl font-semibold leading-tight tracking-tight">Every route, every rider, accounted for.</h1>
          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map((item) => (
              <li key={item.text} className="flex items-start gap-3 text-sm text-white/80">
                <item.icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-(--color-brand-text)" />
                {item.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">© {new Date().getFullYear()} School Transport Platform</p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6">
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <span className="flex h-9 w-9 items-center justify-center rounded-(--radius-sm) bg-[image:var(--gradient-brand)] text-white shadow-(--shadow-sm)">
            <Bus className="h-5 w-5" />
          </span>
          <span className="text-base font-semibold text-(--color-text)">School Transport Platform</span>
        </div>
        <div className="w-full max-w-sm animate-fade-up">{children}</div>
      </div>
    </div>
  );
}
