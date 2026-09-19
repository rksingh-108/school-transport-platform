'use client';

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'stp-theme';

/** Inline script for <head> — runs before first paint so there is no flash of the wrong theme. It toggles the `dark` class on <html> before React hydrates, so the root <html> element carries `suppressHydrationWarning` (see app/layout.tsx). */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.classList.toggle('dark',t==='dark');}catch(e){}})();`;

/** Applies a theme to <html> and persists the choice. Safe to call outside React. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode / sandboxed iframe) — the class is still applied.
  }
}

function getSystemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // fall through to system preference
  }
  return getSystemTheme();
}

/**
 * React hook for reading/toggling the active theme. Initial value is read
 * lazily from storage/system; the returned `theme` also updates when the OS
 * preference changes and no explicit choice has been made.
 */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void; toggleTheme: () => void } {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      try {
        if (!localStorage.getItem(THEME_STORAGE_KEY)) setThemeState(getSystemTheme());
      } catch {
        setThemeState(getSystemTheme());
      }
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggleTheme };
}