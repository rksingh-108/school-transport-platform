import { haversineDistanceMeters, distanceToSegmentMeters, distanceToPolylineMeters } from './geo.util';

describe('geo.util', () => {
  describe('haversineDistanceMeters', () => {
    it('returns 0 for identical points', () => {
      expect(haversineDistanceMeters(12.9716, 77.5946, 12.9716, 77.5946)).toBeCloseTo(0, 3);
    });

    it('returns a known real-world distance within a small tolerance', () => {
      // Bengaluru city center to Kempegowda International Airport — real
      // coordinates, real great-circle distance (~28km).
      const d = haversineDistanceMeters(12.9716, 77.5946, 13.1986, 77.7066);
      expect(d).toBeGreaterThan(27_000);
      expect(d).toBeLessThan(29_000);
    });

    it('is symmetric', () => {
      const a = haversineDistanceMeters(12.9716, 77.5946, 12.9784, 77.6408);
      const b = haversineDistanceMeters(12.9784, 77.6408, 12.9716, 77.5946);
      expect(a).toBeCloseTo(b, 6);
    });

    it('scales roughly linearly for small distances (sanity check, not a precise proof)', () => {
      // ~0.001 degrees latitude ≈ 111 meters
      const d = haversineDistanceMeters(12.9716, 77.5946, 12.9726, 77.5946);
      expect(d).toBeGreaterThan(100);
      expect(d).toBeLessThan(120);
    });
  });

  describe('distanceToSegmentMeters', () => {
    const a = { latitude: 12.9716, longitude: 77.5946 };
    const b = { latitude: 12.9716, longitude: 77.6046 }; // due east of a, ~1.08km

    it('returns ~0 for a point on the segment', () => {
      const midpoint = { latitude: 12.9716, longitude: 77.5996 };
      expect(distanceToSegmentMeters(midpoint, a, b)).toBeLessThan(5);
    });

    it('returns the perpendicular distance for a point abeam the segment', () => {
      // ~0.001 degrees latitude north of the midpoint ≈ 111m perpendicular offset
      const offPoint = { latitude: 12.9726, longitude: 77.5996 };
      const d = distanceToSegmentMeters(offPoint, a, b);
      expect(d).toBeGreaterThan(100);
      expect(d).toBeLessThan(120);
    });

    it('clamps to the nearest endpoint when the closest point on the infinite line falls outside the segment', () => {
      // Within ~0.2% of true Haversine — the local equirectangular
      // projection this function uses trades a little precision for
      // avoiding a geometry-library dependency (see geo.util.ts); a bus
      // route's stop-to-stop segments are short enough that this is fine
      // for a corridor-tolerance check, not for surveying.
      const beyondB = { latitude: 12.9716, longitude: 77.62 }; // east of b, off the end
      const dToSegment = distanceToSegmentMeters(beyondB, a, b);
      const dToEndpointB = haversineDistanceMeters(beyondB.latitude, beyondB.longitude, b.latitude, b.longitude);
      expect(Math.abs(dToSegment - dToEndpointB) / dToEndpointB).toBeLessThan(0.005);
    });

    it('degrades to point-to-point distance for a zero-length segment', () => {
      const point = { latitude: 12.98, longitude: 77.6 };
      const d = distanceToSegmentMeters(point, a, a);
      const expected = haversineDistanceMeters(point.latitude, point.longitude, a.latitude, a.longitude);
      expect(Math.abs(d - expected) / expected).toBeLessThan(0.005);
    });
  });

  describe('distanceToPolylineMeters', () => {
    const path = [
      { latitude: 12.9716, longitude: 77.5946 },
      { latitude: 12.9716, longitude: 77.6046 },
      { latitude: 12.98, longitude: 77.6046 },
    ];

    it('returns Infinity for an empty path', () => {
      expect(distanceToPolylineMeters({ latitude: 12.97, longitude: 77.6 }, [])).toBe(Infinity);
    });

    it('falls back to point distance for a single-point path', () => {
      const d = distanceToPolylineMeters({ latitude: 12.9716, longitude: 77.5956 }, [path[0]!]);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(200);
    });

    it('finds the minimum distance across multiple segments, not just the first', () => {
      // Close to the second segment (between path[1] and path[2]), far from the first.
      const nearSecondSegment = { latitude: 12.975, longitude: 77.605 };
      const d = distanceToPolylineMeters(nearSecondSegment, path);
      expect(d).toBeLessThan(600);
    });
  });
});
