import { useState } from 'react';

/**
 * Wraps the pageCursor/cursorStack pattern every list page duplicated by
 * hand. Callers pass `nextCursor` from the latest fetched page so this hook
 * knows whether a "next" step is possible; it never fetches anything itself.
 */
export function useCursorPagination() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [stack, setStack] = useState<string[]>([]);

  function reset() {
    setCursor(null);
    setStack([]);
  }

  function next(nextCursor: string | null | undefined) {
    if (!nextCursor) return;
    setStack((s) => [...s, cursor ?? '']);
    setCursor(nextCursor);
  }

  function prev() {
    setStack((s) => {
      const copy = [...s];
      const previous = copy.pop();
      setCursor(previous || null);
      return copy;
    });
  }

  return { cursor, hasPrev: stack.length > 0, next, prev, reset };
}
