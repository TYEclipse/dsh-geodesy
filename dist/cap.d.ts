/**
 * Spherical cap ("circle on a sphere") geometry for dsh-geodesy.
 *
 * A cap is every point within `radiusKm` of a centre, measured along the
 * surface. Unlike a planar disc it has no straight boundary and no simple
 * box: the boundary is a small circle, and the cap's bounding box has to
 * account for poles (which unlock every longitude) and for the antimeridian
 * (where the box wraps).
 *
 * Closed forms used here (all exact on a sphere):
 *   angular radius   d        = min(radius / R, pi)
 *   area             A        = 2 pi R^2 (1 - cos d)      [solid angle 2 pi (1 - cos d)]
 *   boundary length  C        = 2 pi R sin d
 *   latitude extent           = centre.lat +/- d          (clamped at the poles)
 *   longitude extent          = +/- asin(sin d / cos centre.lat)
 *                               (defined only while the cap stays clear of a pole;
 *                                a pole inside the cap means every longitude)
 *
 * @module dsh-geodesy/cap
 */
import { type Point } from './geodesy.ts';
/** Arc tolerance for "on the boundary": 1e-9 rad ≈ 6 mm on an Earth-sized sphere. */
export declare const BOUNDARY_TOL_RAD = 1e-9;
export interface CapInfo {
    /** Angular radius of the cap in degrees (capped at 180). */
    angularRadiusDeg: number;
    /** Surface area of the cap in km². */
    areaKm2: number;
    /** Fraction of the whole sphere the cap covers (0 to 1). */
    surfaceFraction: number;
    /** Length of the boundary circle in km. */
    boundaryKm: number;
    /** True when the boundary is itself a great circle (angular radius exactly 90°). */
    boundaryIsGreatCircle: boolean;
    /** Southern edge of the cap's latitude box (degrees). */
    minLat: number;
    /** Northern edge of the cap's latitude box (degrees). */
    maxLat: number;
    /** Western edge of the cap's longitude box (degrees; may exceed maxLon, see crossesAntimeridian). */
    minLon: number;
    /** Eastern edge of the cap's longitude box (degrees). */
    maxLon: number;
    /** True longitude width in degrees (2 x the longitude half-span). */
    lonSpanDeg: number;
    /** True when the longitude box wraps the antimeridian (minLon is east of maxLon). */
    crossesAntimeridian: boolean;
    /** True when the cap touches or contains a pole, so every longitude is inside it. */
    coversAllLongitudes: boolean;
    /** True when the cap contains the north pole. */
    includesNorthPole: boolean;
    /** True when the cap contains the south pole. */
    includesSouthPole: boolean;
    /** True when the radius reaches half the circumference, so the cap is the whole sphere. */
    coversWholeSphere: boolean;
    /** Great-circle distance from the centre to the query point (km), when one was given. */
    pointDistanceKm?: number;
    /** True when the query point is inside the cap (a boundary hit counts as neither inside nor outside). */
    containsPoint?: boolean;
    /** True when the query point sits on the boundary circle (within ~6 mm). */
    pointOnBoundary?: boolean;
}
export interface CapOutcome {
    result?: CapInfo;
    error?: string;
}
/**
 * Every quantity the `geo_circle` tool reports, for a cap of `radiusKm`
 * around `center` on a sphere of `sphereRadiusKm`. Pass `point` to also get
 * the containment verdict for that point.
 */
export declare function sphericalCap(center: Point, radiusKm: number, sphereRadiusKm?: number, point?: Point): CapOutcome;
//# sourceMappingURL=cap.d.ts.map