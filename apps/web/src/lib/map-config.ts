/**
 * Map tile provider configuration.
 *
 * Defaults to standard OpenStreetMap raster tiles — no API key, no account,
 * works immediately in every environment. OSM's own tile servers are meant
 * for modest, non-commercial-scale traffic (this app's realistic load —
 * one school's staff/parents viewing a handful of buses — fits well within
 * that); see https://operations.osmfoundation.org/policies/tiles/.
 *
 * For a real production deployment at real scale, set
 * NEXT_PUBLIC_MAP_TILE_URL_LIGHT/_DARK and NEXT_PUBLIC_MAP_ATTRIBUTION to
 * point at a paid tile provider (Mapbox, MapTiler, Google Maps, ...) with an
 * SLA — no code change required. There is deliberately no separate "dark"
 * OSM tile source (that requires a paid provider too); dark mode instead
 * applies a CSS filter to the same light tiles (see globals.css) — a common,
 * good-enough technique that avoids a second raster source.
 *
 * See docs/adr/0007-map-and-storage-provider-abstraction.md.
 */
export const MAP_TILE_URL_LIGHT = process.env.NEXT_PUBLIC_MAP_TILE_URL_LIGHT ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

export const MAP_TILE_URL_DARK = process.env.NEXT_PUBLIC_MAP_TILE_URL_DARK ?? MAP_TILE_URL_LIGHT;

export const MAP_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const MAP_TILE_SUBDOMAINS = ['a', 'b', 'c'];
