'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { useHasMounted } from '@/lib/use-has-mounted';
import { IconButton } from './button';

/** Light/dark switch — shows the icon of the mode you'd switch TO. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  // The persisted/system theme is only knowable on the client. Render the
  // light-mode icon until hydrated so the server and client agree (the
  // themeInitScript sets the real `dark` class before first paint).
  const mounted = useHasMounted();
  const isDark = mounted && theme === 'dark';
  return (
    <IconButton
      icon={isDark ? Sun : Moon}
      label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      variant="ghost"
      onClick={toggleTheme}
      className={className}
    />
  );
}