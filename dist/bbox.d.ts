/**
 * Spherical bounding boxes for dsh-geodesy.
 *
 * A bounding box on a sphere is where almost every hand-rolled implementation
 * goes quietly wrong, so this module is explicit about the three cases:
 *
 *   1. **The box of a route is not the box of its waypoints.** A great-circle
 *      arc between two waypoints can reach latitudes that neither waypoint
 *      has (a 40°N → 40°N crossing of 120° of longitude climbs to ~48.5°N).
 *      `shape: 'path'` therefore looks for the latitude extreme of every leg
 *      and includes it; `shape: 'points'` does not, and says so.
 *   2. **A box that reaches a pole spans every longitude.** Nothing sensible
 *      can be said about minLon/maxLon once a pole is inside, so the box is
 *      reported as the full range with `coversAllLongitudes: true`.
 *   3. **A box that wraps the antimeridian needs two boxes.** The minimal
 *      longitude interval is found by cutting the longitude circle at its
 *      largest gap; when that interval crosses ±180° it is returned as two
 *      boxes, each with minLon < maxLon, instead of a reversed pair nobody
 *      can use in a map query.
 *
 * The latitude extreme of a great circle through unit vectors v1, v2 is the
 * projection of the north pole onto the circle's plane,
 * `m = unit(z - (z·n) n)` with `n = unit(v1 × v2)`: m is the point on the
 * circle with the largest z, its antipode the smallest. `|m| = 0` means the
 * circle is the equator. Whether that extreme belongs to the *arc* is decided
 * by measuring the signed angle from v1 about n, exactly like the
 * cross-track module does.
 *
 * @module dsh-geodesy/bbox
 */
import { type Point } from './geodesy.ts';
/** Normalise a longitude into [-180, 180) so that ±180 is one value. */
export declare function normalizeLon(lon: number): number;
export type BBoxShape = 'points' | 'path';
/** One axis-aligned latitude/longitude box; always minLat <= maxLat, minLon <= maxLon. */
export interface BoundingBox {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
}
export interface BBoxInfo {
    /** What the box is guaranteed to contain: the vertices, or the whole route. */
    shape: BBoxShape;
    /** One box, or two when the longitude interval wraps the antimeridian. */
    boxes: BoundingBox[];
    /** Southern edge of the latitude extent (degrees). */
    minLat: number;
    /** Northern edge of the latitude extent (degrees). */
    maxLat: number;
    /** True longitude width in degrees (0 to 360). */
    lonSpanDeg: number;
    /** True when two boxes are needed because the interval crosses ±180°. */
    crossesAntimeridian: boolean;
    /** True when a pole is inside the box, so every longitude is included. */
    coversAllLongitudes: boolean;
    includesNorthPole: boolean;
    includesSouthPole: boolean;
    /** Number of input points. */
    vertices: number;
    /** Number of analysed legs (0 for a point set). */
    legs: number;
    /**
     * Route mode only: how many km the arcs reach beyond the latitude extent of
     * the waypoints themselves (0 when the waypoints are already the extremes).
     */
    bulgeKm?: number;
}
export interface BBoxOutcome {
    result?: BBoxInfo;
    error?: string;
}
/** Fewest / most points a bounding box may be computed from. */
export declare const BBOX_MIN_POINTS = 2;
export declare const BBOX_MAX_POINTS = 50;
/**
 * Bounding box of a point set (`shape: 'points'`) or of a route
 * (`shape: 'path'`, whose legs are the great-circle arcs between consecutive
 * points). Distances only enter through `bulgeKm`; the box itself is angular.
 */
export declare function sphericalBBox(shape: BBoxShape, points: Point[], radiusKm?: number): BBoxOutcome;
//# sourceMappingURL=bbox.d.ts.map