import type { CursorPage } from '@school-transport/shared-types';

/**
 * Turns an over-fetched-by-one Prisma result (`take: limit + 1`) into a
 * cursor page. Deliberately not a generic "paginate(prisma.model, ...)"
 * helper — fighting Prisma's delegate generics for that would cost more than
 * the ~8 lines it would save in each of the 3 call sites (docs/architecture.md's
 * "no premature abstraction" principle). This piece — turning `items` into
 * `{data, nextCursor}` — is the part that's actually identical everywhere.
 */
export function toCursorPage<T extends { id: string }>(items: T[], limit: number): CursorPage<T> {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  const last = data[data.length - 1];
  return { data, nextCursor: hasMore && last ? last.id : null };
}
