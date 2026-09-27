/**
 * Point-in-polygon test for dsh-geodesy, matching the winding semantics of
 * `sphericalPolygonArea`: the polygon is a closed sequence of great-circle
 * edges, and the answer is reported for BOTH regions the boundary delimits.
 *
 * Method: a ray (half great circle) is cast from the query point along a
 * great circle chosen so that no vertex lies on it; every edge crossing that
 * ray adds +1 or -1 depending on whether the boundary's azimuth about the
 * query point increases or decreases there (the planar winding rule, lifted
 * to the sphere). A non-zero winding means the boundary winds around the
 * point, i.e. the point is inside the region it encloses.
 *
 * Why not the cheaper "sum of tangent-plane angles at the query point"? That
 * method has an antipodal blind spot: for a point near the antipode of the
 * polygon the angles wrap spuriously and it reports "inside" for points that
 * are nowhere near the polygon (and for tiny polygons it does so at their
 * exact antipode). The crossing form has no such discontinuity.
 *
 * Two booleans come out of the winding, because a polygon on a sphere always
 * has two sides:
 *   insideEnclosed   — the everyday "is the point inside the polygon", i.e.
 *                      the region the boundary winds around.
 *   insideLeftRegion — the region to the LEFT of the directed edges, which is
 *                      the same thing for counter-clockwise vertex order and
 *                      the complement for clockwise order. This is the region
 *                      whose area `geo_area` reports as `areaKm2`.
 *
 * Points within `BOUNDARY_TOLERANCE_RAD` of an edge are reported as
 * `onBoundary` and in neither region (a boundary is not a side).
 *
 * @module dsh-geodesy/region
 */
import { type Point } from './geodesy.ts';
/** Angular tolerance for "the point lies on the boundary" (~6 mm on Earth). */
export declare const BOUNDARY_TOLERANCE_RAD = 1e-9;
export interface PointInPolygonInfo {
    /** Point is in the region enclosed by the boundary (the ordinary polygon). */
    insideEnclosed: boolean;
    /** Point is in the region LEFT of the directed edges (cf. `geo_area`). */
    insideLeftRegion: boolean;
    /** Point sits on the boundary itself, within the tolerance. */
    onBoundary: boolean;
    /** Winding number of the boundary around the point (0, +1 or -1); omitted on the boundary. */
    winding?: number;
    /** True when the left region is the enclosed one (counter-clockwise vertex order). */
    leftIsEnclosed: boolean;
    /** Area of the region LEFT of the directed edges (km²). */
    areaKm2: number;
    /** Area of the other region (km²). */
    complementKm2: number;
}
export interface PointInPolygonOutcome {
    result?: PointInPolygonInfo;
    error?: string;
}
/**
 * Test whether `point` lies inside the spherical polygon `points` (vertices in
 * boundary order, 3 to 100 of them, no consecutive duplicate or antipodal
 * vertices). Both the enclosed region and the left-of-edges region are
 * reported; see the module docs for what each one means.
 */
export declare function pointInPolygon(points: Point[], point: Point, radiusKm?: number): PointInPolygonOutcome;
//# sourceMappingURL=region.d.ts.map