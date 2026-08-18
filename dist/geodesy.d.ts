/**
 * Core geodesic math for dsh-geodesy: great-circle (spherical) geometry on a
 * sphere of configurable radius. Pure trigonometry, zero dependencies.
 *
 * Formulas follow the standard spherical-haversine and direct-problem
 * derivations (Movable Type Scripts conventions, IUGG mean Earth radius).
 * All angles are decimal degrees externally, radians internally.
 *
 * @module dsh-geodesy/geodesy
 */
export declare const DEFAULT_RADIUS_KM = 6371.0088;
/** Distance units, expressed as units per kilometre. */
export declare const UNIT_FACTORS: Readonly<Record<string, number>>;
export declare const DISTANCE_UNITS: readonly ["km", "m", "mi", "nmi"];
export type DistanceUnit = (typeof DISTANCE_UNITS)[number];
export interface Point {
    lat: number;
    lon: number;
}
/** Round to `digits` decimal places (kills floating-point dust for output). */
export declare function round(value: number, digits?: number): number;
/** Validate a lat/lon pair; returns an error string or undefined when valid. */
export declare function validatePoint(lat: number, lon: number): string | undefined;
/** Great-circle distance in km via the haversine formula. */
export declare function haversineKm(a: Point, b: Point, radiusKm?: number): number;
/** Initial bearing (forward azimuth) from `a` to `b` in degrees [0, 360). */
export declare function initialBearing(a: Point, b: Point): number;
/** Final bearing: the heading on arrival, i.e. the reverse of b→a's initial bearing. */
export declare function finalBearing(a: Point, b: Point): number;
/** Direct problem: destination point given start, bearing and great-circle distance. */
export declare function destinationPoint(start: Point, bearingDeg: number, distanceKm: number, radiusKm?: number): Point;
/** Half-way point along the great circle between `a` and `b`. */
export declare function midpointOf(a: Point, b: Point): Point;
/** Sixteen-wind compass point for a bearing in degrees. */
export declare function compassPoint(bearingDeg: number): string;
/** Format decimal degrees as DMS with a direction suffix (N/S/E/W). */
export declare function formatDms(decimalDeg: number, isLat: boolean): string;
//# sourceMappingURL=geodesy.d.ts.map