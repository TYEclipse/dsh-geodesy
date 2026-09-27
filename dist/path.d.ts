/**
 * Cross-track / along-track geometry for dsh-geodesy.
 *
 * Answers the everyday navigation question "how far am I off this path, and
 * where is my closest point on it?" with 3D unit-vector math (no angle-case
 * formulas), so poles, antipodal starts and coincident points behave.
 *
 * Definitions used throughout (and echoed in the tool description):
 *   crossTrackKm > 0  <=>  the query point lies to the LEFT of the path
 *                          p1 -> p2, where "left" is the right-hand-rule side
 *                          of the direction of travel seen from outside the
 *                          sphere.
 *   alongTrackKm  > 0  <=>  the perpendicular foot lies AHEAD of p1 along the
 *                          path; negative means it lies behind p1.
 *
 * The perpendicular foot is `unit(v3 - (v3 . n) n)` where `n = unit(v1 x v2)`
 * is the great-circle normal; the along-track distance is the signed arc from
 * `v1` to that foot measured about `n`.
 *
 * @module dsh-geodesy/path
 */
import { type Point } from './geodesy.ts';
export interface CrossTrackInfo {
    /** Signed perpendicular distance to the great circle through p1,p2 (km). */
    crossTrackKm: number;
    /** Signed distance from p1 along the path to the perpendicular foot (km). */
    alongTrackKm: number;
    /** The perpendicular foot: the closest point on the path's great circle. */
    foot: Point;
    /** True when the foot lies between p1 and p2 (inclusive). */
    withinSegment: boolean;
    /** Distance from the query point to the nearest point of the segment p1-p2. */
    distanceToSegmentKm: number;
    /** Great-circle length of the path p1-p2. */
    pathLengthKm: number;
}
export interface CrossTrackOutcome {
    result?: CrossTrackInfo;
    error?: string;
}
/**
 * Cross-track / along-track data for `p3` relative to the path `p1 -> p2`.
 * Returns an error string when the path is degenerate (coincident or
 * antipodal endpoints) or when `p3` is exactly 90 degrees off the path
 * (every point of the path is then equidistant, so no foot is unique).
 */
export declare function crossTrack(p1: Point, p2: Point, p3: Point, radiusKm?: number): CrossTrackOutcome;
//# sourceMappingURL=path.d.ts.map