import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * True only after the client has hydrated. Using `useSyncExternalStore`
 * (rather than `useState` + `useEffect(() => setMounted(true), [])`) avoids
 * both the SSR/hydration mismatch AND the set-state-in-effect lint rule —
 * this is React's own documented pattern for this exact problem.
 */
export function useHasMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
