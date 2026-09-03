/**
 * Spherical polygon area for dsh-geodesy (Girard's theorem / spherical
 * excess). Pure 3D vector math, zero dependencies, pole-safe.
 *
 * At each vertex the interior angle of the region LEFT of the directed
 * edges is computed from the unit tangent vectors toward the previous and
 * next vertices:
 *   alpha_i = atan2(v_i . (u_i x w_i), w_i . u_i)  normalized to [0, 2*pi)
 * The spherical excess E = sum(alpha_i) - (n - 2)*pi gives the area of the
 * left region as R^2 * E (up to the full sphere area 4*pi*R^2).
 *
 * Semantics: with counter-clockwise vertex order (as seen from outside the
 * sphere, the enclosed region on the left of each directed edge) the result
 * is the polygon itself; with clockwise order the result is its complement.
 * A complement value is always included, so the other region is one field
 * away regardless of winding.
 *
 * @module dsh-geodesy/area
 */
import { type Point } from './geodesy.ts';
export declare const MAX_VERTICES = 100;
export interface PolygonAreaInfo {
    areaKm2: number;
    perimeterKm: number;
    excessRadians: number;
    /** Area of the region on the other side of the edges (4*pi*R^2 - area). */
    complementKm2: number;
}
export interface PolygonAreaOutcome {
    result?: PolygonAreaInfo;
    error?: string;
}
/**
 * Compute the area and perimeter of a spherical polygon from its vertices
 * (ordered along the boundary). The reported area is the region to the
 * LEFT of the directed edges; see the module docs for winding semantics.
 * The polygon must be simple (non-self-intersecting); at most 100 vertices.
 */
export declare function sphericalPolygonArea(points: Point[], radiusKm?: number): PolygonAreaOutcome;
//# sourceMappingURL=area.d.ts.map