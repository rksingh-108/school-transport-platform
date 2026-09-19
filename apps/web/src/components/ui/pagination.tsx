import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';

export function CursorPagination({
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mt-3 flex items-center justify-end gap-2">
      <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={!hasPrev} onClick={onPrev}>
        Previous
      </Button>
      <Button variant="secondary" size="sm" disabled={!hasNext} onClick={onNext}>
        Next
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
