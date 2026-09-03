/**
 * Intersection of two great-circle paths for dsh-geodesy.
 *
 * A "path" is the full great circle through a start point with a given
 * initial bearing. Two distinct great circles on a sphere always cross at
 * exactly two antipodal points, so the result is deterministic: the crossing
 * nearest to the first path's start is reported as the primary point, and
 * the antipodal crossing is included alongside it.
 *
 * Implementation is pure 3D vector math (no angle-case formulas), which is
 * robust for polar regions, antipodal starts, and identical start points:
 *   n_i = unit(p_i x d_i)      circle normal (d_i = unit tangent at p_i)
 *   x   = +/- unit(n_1 x n_2)  the two crossings
 *
 * @module dsh-geodesy/intersection
 */
import { type Point } from './geodesy.ts';
export interface IntersectionPoint {
    lat: number;
    lon: number;
    distanceFromStart1Km: number;
    distanceFromStart2Km: number;
}
export interface IntersectionOutcome {
    result?: {
        point: IntersectionPoint;
        antipode: IntersectionPoint;
        /** True when the primary crossing lies on the reverse side of path 1. */
        behindStart1: boolean;
    };
    error?: string;
}
/**
 * Compute the crossing of two great-circle paths.
 * `p1`/`p2` are the path starts, `brng1`/`brng2` their initial bearings
 * (degrees, [0, 360)). Returns an error string for coincident paths,
 * pole starts, or invalid inputs.
 */
export declare function greatCircleIntersection(p1: Point, brng1: number, p2: Point, brng2: number, radiusKm?: number): IntersectionOutcome;
//# sourceMappingURL=intersection.d.ts.map