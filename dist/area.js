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
import { DEFAULT_RADIUS_KM, haversineKm } from "./geodesy.js";
const DEG = Math.PI / 180;
export const MAX_VERTICES = 100;
function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}
function latLonToXyz(lat, lon) {
    const la = lat * DEG;
    const lo = lon * DEG;
    return { x: Math.cos(la) * Math.cos(lo), y: Math.cos(la) * Math.sin(lo), z: Math.sin(la) };
}
/** Unit tangent at vertex `v` pointing toward neighbor `t` (undefined if antipodal). */
function tangentToward(v, t) {
    const d = dot(t, v);
    const raw = { x: t.x - d * v.x, y: t.y - d * v.y, z: t.z - d * v.z };
    const n = Math.sqrt(dot(raw, raw));
    if (n < 1e-9)
        return undefined; // identical or antipodal neighbors
    return { x: raw.x / n, y: raw.y / n, z: raw.z / n };
}
/**
 * Compute the area and perimeter of a spherical polygon from its vertices
 * (ordered along the boundary). The reported area is the region to the
 * LEFT of the directed edges; see the module docs for winding semantics.
 * The polygon must be simple (non-self-intersecting); at most 100 vertices.
 */
export function sphericalPolygonArea(points, radiusKm = DEFAULT_RADIUS_KM) {
    const n = points.length;
    if (n < 3)
        return { error: `a polygon needs at least 3 vertices, got ${n}` };
    if (n > MAX_VERTICES)
        return { error: `too many vertices (${n}); the limit is ${MAX_VERTICES}` };
    for (const p of points) {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) {
            return { error: 'every vertex must have finite numeric lat/lon' };
        }
        if (p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180) {
            return { error: `vertex (${p.lat}, ${p.lon}) is out of range (lat [-90, 90], lon [-180, 180])` };
        }
    }
    const verts = points.map((p) => latLonToXyz(p.lat, p.lon));
    let total = 0;
    for (let i = 0; i < n; i += 1) {
        const v = verts[i];
        const w = tangentToward(v, verts[(i - 1 + n) % n]);
        const u = tangentToward(v, verts[(i + 1) % n]);
        if (w === undefined || u === undefined) {
            return { error: `adjacent vertices around index ${i} are identical or antipodal — no unique great-circle edge` };
        }
        const interior = Math.atan2(dot(v, cross(u, w)), dot(w, u));
        total += interior < 0 ? interior + 2 * Math.PI : interior;
    }
    const excess = total - (n - 2) * Math.PI;
    const area = radiusKm * radiusKm * excess;
    let perimeter = 0;
    for (let i = 0; i < n; i += 1) {
        perimeter += haversineKm(points[i], points[(i + 1) % n], radiusKm);
    }
    return {
        result: {
            areaKm2: area,
            perimeterKm: perimeter,
            excessRadians: excess,
            complementKm2: 4 * Math.PI * radiusKm * radiusKm - area,
        },
    };
}
//# sourceMappingURL=area.js.map