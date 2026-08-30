import { computeWindowStart, assertObservationTimestampSane, ObservationTimestampError } from './observation-window';

describe('computeWindowStart', () => {
  it('floors to the start of a 30s window', () => {
    const t = new Date('2026-08-30T12:00:47.500Z');
    expect(computeWindowStart(t, 30).toISOString()).toBe('2026-08-30T12:00:30.000Z');
  });

  it('two timestamps in the same window produce the same windowStart', () => {
    const a = new Date('2026-08-30T12:00:31.000Z');
    const b = new Date('2026-08-30T12:00:59.999Z');
    expect(computeWindowStart(a, 30).getTime()).toBe(computeWindowStart(b, 30).getTime());
  });

  it('two timestamps straddling a window boundary produce different windowStarts', () => {
    const a = new Date('2026-08-30T12:00:29.999Z');
    const b = new Date('2026-08-30T12:00:30.000Z');
    expect(computeWindowStart(a, 30).getTime()).not.toBe(computeWindowStart(b, 30).getTime());
  });

  it('handles a window size that does not evenly divide the minute', () => {
    const t = new Date('2026-08-30T12:00:47.000Z');
    // 45s windows starting from epoch: floor(epochSeconds/45)*45
    const expected = new Date(Math.floor(t.getTime() / 45000) * 45000);
    expect(computeWindowStart(t, 45).getTime()).toBe(expected.getTime());
  });
});

describe('assertObservationTimestampSane', () => {
  const now = new Date('2026-08-30T12:00:00.000Z');

  it('accepts a timestamp at now', () => {
    expect(() => assertObservationTimestampSane(now, now, 120, 3600)).not.toThrow();
  });

  it('accepts a timestamp within the allowed past window', () => {
    const t = new Date(now.getTime() - 3600 * 1000);
    expect(() => assertObservationTimestampSane(t, now, 120, 3600)).not.toThrow();
  });

  it('rejects a timestamp beyond the allowed past window', () => {
    const t = new Date(now.getTime() - 3601 * 1000);
    expect(() => assertObservationTimestampSane(t, now, 120, 3600)).toThrow(ObservationTimestampError);
  });

  it('accepts a timestamp within the allowed future skew', () => {
    const t = new Date(now.getTime() + 120 * 1000);
    expect(() => assertObservationTimestampSane(t, now, 120, 3600)).not.toThrow();
  });

  it('rejects a timestamp beyond the allowed future skew', () => {
    const t = new Date(now.getTime() + 121 * 1000);
    expect(() => assertObservationTimestampSane(t, now, 120, 3600)).toThrow(ObservationTimestampError);
  });

  it('rejects an invalid (NaN) timestamp', () => {
    expect(() => assertObservationTimestampSane(new Date('not-a-date'), now, 120, 3600)).toThrow(ObservationTimestampError);
  });
});
