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
import { DEFAULT_RADIUS_KM, haversineKm } from "./geodesy.js";
const DEG = Math.PI / 180;
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
function unit(v) {
    const n = Math.sqrt(dot(v, v));
    return { x: v.x / n, y: v.y / n, z: v.z / n };
}
function clamp1(t) {
    return Math.max(-1, Math.min(1, t));
}
function latLonToXyz(lat, lon) {
    const la = lat * DEG;
    const lo = lon * DEG;
    return { x: Math.cos(la) * Math.cos(lo), y: Math.cos(la) * Math.sin(lo), z: Math.sin(la) };
}
function xyzToLatLon(v) {
    const u = unit(v);
    const lat = Math.asin(clamp1(u.z)) / DEG;
    const lon = ((Math.atan2(u.y, u.x) / DEG + 540) % 360) - 180;
    return { lat, lon };
}
/**
 * Cross-track / along-track data for `p3` relative to the path `p1 -> p2`.
 * Returns an error string when the path is degenerate (coincident or
 * antipodal endpoints) or when `p3` is exactly 90 degrees off the path
 * (every point of the path is then equidistant, so no foot is unique).
 */
export function crossTrack(p1, p2, p3, radiusKm = DEFAULT_RADIUS_KM) {
    const v1 = latLonToXyz(p1.lat, p1.lon);
    const v2 = latLonToXyz(p2.lat, p2.lon);
    const v3 = latLonToXyz(p3.lat, p3.lon);
    const nRaw = cross(v1, v2);
    const nLen = Math.sqrt(dot(nRaw, nRaw));
    if (nLen < 1e-12) {
        return {
            error: dot(v1, v2) > 0
                ? 'the path start and end coincide — a path needs two distinct points'
                : 'the path endpoints are antipodal — infinitely many great circles pass through them',
        };
    }
    const n = { x: nRaw.x / nLen, y: nRaw.y / nLen, z: nRaw.z / nLen };
    const crossTrackKm = Math.asin(clamp1(dot(v3, n))) * radiusKm;
    const proj = {
        x: v3.x - dot(v3, n) * n.x,
        y: v3.y - dot(v3, n) * n.y,
        z: v3.z - dot(v3, n) * n.z,
    };
    if (Math.sqrt(dot(proj, proj)) < 1e-12) {
        return {
            error: 'the query point is exactly 90 degrees off the path — every point of the path is '
                + 'equidistant, so the perpendicular foot is not unique',
        };
    }
    const footVec = unit(proj);
    const pathAngle = Math.atan2(nLen, dot(v1, v2));
    const alongAngle = Math.atan2(dot(cross(v1, footVec), n), dot(v1, footVec));
    const withinSegment = alongAngle >= -1e-12 && alongAngle <= pathAngle + 1e-12;
    const alongTrackKm = alongAngle * radiusKm;
    return {
        result: {
            crossTrackKm,
            alongTrackKm,
            foot: xyzToLatLon(footVec),
            withinSegment,
            distanceToSegmentKm: withinSegment
                ? Math.abs(crossTrackKm)
                : Math.min(haversineKm(p3, p1, radiusKm), haversineKm(p3, p2, radiusKm)),
            pathLengthKm: pathAngle * radiusKm,
        },
    };
}
//# sourceMappingURL=path.js.map