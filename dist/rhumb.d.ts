/**
 * Rhumb-line (loxodrome) math for dsh-geodesy: distance and constant
 * bearing along a line of constant heading — the navigational counterpart
 * to the great-circle tools. Pure trigonometry, zero dependencies.
 *
 * Closed form (standard loxodrome derivations):
 *   dpsi  = ln(tan(pi/4 + lat2/2) / tan(pi/4 + lat1/2))   (meridional parts)
 *   q     = dlat / dpsi, or cos(lat1) when |dpsi| ~ 0      (equal latitudes)
 *   dist  = R * sqrt(dlat^2 + q^2 * dlon^2)
 *   brng  = atan2(dlon, dpsi)
 *
 * @module dsh-geodesy/rhumb
 */
import { type Point } from './geodesy.ts';
/** Rhumb-line (constant-heading) distance in km. */
export declare function rhumbDistanceKm(a: Point, b: Point, radiusKm?: number): number;
/**
 * Constant bearing (heading) along the rhumb line from `a` to `b`, in
 * degrees [0, 360). Returns 0 when the two points coincide (no unique
 * heading exists for a zero-length line).
 */
export declare function rhumbBearing(a: Point, b: Point): number;
//# sourceMappingURL=rhumb.d.ts.map