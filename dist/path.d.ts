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
/** One leg of a multi-point path. */
export interface PolylineLeg {
    /** 1-based index of the leg (the leg from waypoint i to waypoint i+1). */
    leg: number;
    /** 0-based index of the leg's start waypoint. */
    fromIndex: number;
    /** 0-based index of the leg's end waypoint. */
    toIndex: number;
    /** Great-circle length of this leg in km. */
    distanceKm: number;
    /** Total distance from the first waypoint to this leg's end, in km. */
    cumulativeKm: number;
    /** Initial bearing of this leg in degrees; absent when the leg is zero-length (no heading exists). */
    initialBearing?: number;
    /** Compass point for the leg's heading; absent when the leg is zero-length. */
    compass?: string;
}
export interface PolylineInfo {
    /** Number of waypoints on the path. */
    points: number;
    /** Every leg, in order. */
    legs: PolylineLeg[];
    /** Sum of all leg lengths, in km. */
    totalKm: number;
    /** Great-circle distance from the first waypoint straight to the last, in km. */
    straightKm: number;
    /** totalKm - straightKm: how much further the route is than flying direct, in km. */
    detourKm: number;
    /** Distance from the last waypoint back to the first, in km. */
    closureKm: number;
    /** True when the last waypoint is the first waypoint (the path closes a loop). */
    closesLoop: boolean;
    /** Length of the longest leg, in km. */
    maxLegKm: number;
    /** Length of the shortest leg, in km. */
    minLegKm: number;
    /** 1-based numbers of the zero-length legs (identical consecutive waypoints). */
    zeroLengthLegs: number[];
}
export interface PolylineOutcome {
    result?: PolylineInfo;
    error?: string;
}
/** Fewest / most waypoints a multi-point path may have. */
export declare const POLYLINE_MIN_POINTS = 2;
export declare const POLYLINE_MAX_POINTS = 50;
/**
 * Path totals for an ordered list of waypoints: per-leg distances and
 * headings, the running total, and how much longer the route is than the
 * straight line between its endpoints.
 *
 * A zero-length leg (two identical consecutive waypoints) is reported with
 * its length 0 and *no* heading — the bearing of a zero-length great circle
 * is undefined, and inventing 0° there would be a silent wrong answer.
 * `detourKm` is derived from the two reported totals so a reader can check it
 * by hand; whether it may be expressed as a percentage is decided by the
 * caller (`straightKm === 0` means there is no percentage).
 */
export declare function polylinePath(points: Point[], radiusKm?: number): PolylineOutcome;
//# sourceMappingURL=path.d.ts.map