const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two lat/lng points, in meters — the
 * standard Haversine formula. Accurate enough for geofence/corridor
 * purposes at bus-route scale; no PostGIS/polygon GIS is used this phase
 * (see docs/adr/0020-geofencing-and-operational-safety-rules.md).
 */
export function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Approximate distance in meters from `point` to the line segment
 * `segmentStart → segmentEnd`, by projecting onto a local equirectangular
 * plane (meters-per-degree scaled by latitude) rather than true geodesic
 * segment math — a deliberate simplification: over the short segment
 * lengths between consecutive stops on a bus route (typically well under a
 * few km), the projection error is negligible for a corridor-tolerance
 * check, and a full geodesic projection would need a geometry library this
 * project has no other reason to depend on. If the segment has zero length
 * (both endpoints identical), this degrades to point-to-point distance.
 */
export function distanceToSegmentMeters(point: LatLng, segmentStart: LatLng, segmentEnd: LatLng): number {
  const latRad = toRadians((segmentStart.latitude + segmentEnd.latitude) / 2);
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = 111_320 * Math.cos(latRad);

  const toLocalXY = (p: LatLng) => ({
    x: (p.longitude - segmentStart.longitude) * metersPerDegreeLng,
    y: (p.latitude - segmentStart.latitude) * metersPerDegreeLat,
  });

  const p = toLocalXY(point);
  const a = { x: 0, y: 0 }; // segmentStart, by construction
  const b = toLocalXY(segmentEnd);

  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;

  let t = lengthSquared === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared;
  t = Math.max(0, Math.min(1, t)); // clamp to the segment, not the infinite line

  const closest = { x: a.x + t * abx, y: a.y + t * aby };
  const dx = p.x - closest.x;
  const dy = p.y - closest.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Minimum distance from `point` to the polyline formed by `path` in order
 * — the "corridor" a trip's planned stops form. Returns `Infinity` for a
 * path with fewer than 2 points (nothing to measure a corridor against);
 * callers should treat that as "cannot evaluate," not "infinitely
 * deviated."
 */
export function distanceToPolylineMeters(point: LatLng, path: LatLng[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return haversineDistanceMeters(point.latitude, point.longitude, path[0]!.latitude, path[0]!.longitude);

  let min = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const d = distanceToSegmentMeters(point, path[i]!, path[i + 1]!);
    if (d < min) min = d;
  }
  return min;
}
