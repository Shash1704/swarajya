/**
 * Map projection: a simple equirectangular projection of southern Asia, from
 * Persia to the Malay world, scaled so one degree of latitude is PX_PER_DEG world pixels.
 */
export const LON0 = 44;
export const LON1 = 110;
export const LAT0 = 40; // top edge
export const LAT1 = -2; // bottom edge
export const PX_PER_DEG = 56;
/** Longitude is squashed by cos(21°) so shapes look right at India's latitude. */
export const KX = PX_PER_DEG * Math.cos((21 * Math.PI) / 180);

/** World pixels per map cell (the grid provinces are built on). */
export const CELL = 3;
export const MW = Math.ceil(((LON1 - LON0) * KX) / CELL);
export const MH = Math.ceil(((LAT0 - LAT1) * PX_PER_DEG) / CELL);
/** World size in pixels. */
export const WW = MW * CELL;
export const WH = MH * CELL;

export type LL = [number, number]; // [lon, lat]

export function toWorld(lon: number, lat: number): [number, number] {
  return [(lon - LON0) * KX, (LAT0 - lat) * PX_PER_DEG];
}

export function cellToLonLat(cx: number, cy: number): LL {
  return [LON0 + (cx * CELL) / KX, LAT0 - (cy * CELL) / PX_PER_DEG];
}
