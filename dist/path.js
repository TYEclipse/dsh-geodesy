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
import { DEFAULT_RADIUS_KM, compassPoint, haversineKm, initialBearing } from "./geodesy.js";
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
/** Fewest / most waypoints a multi-point path may have. */
export const POLYLINE_MIN_POINTS = 2;
export const POLYLINE_MAX_POINTS = 50;
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
export function polylinePath(points, radiusKm = DEFAULT_RADIUS_KM) {
    if (points.length < POLYLINE_MIN_POINTS) {
        return { error: `a path needs at least ${POLYLINE_MIN_POINTS} waypoints (got ${points.length})` };
    }
    if (points.length > POLYLINE_MAX_POINTS) {
        return { error: `a path supports at most ${POLYLINE_MAX_POINTS} waypoints (got ${points.length})` };
    }
    for (let index = 0; index < points.length; index += 1) {
        const p = points[index];
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) {
            return { error: 'every waypoint must have finite numeric lat/lon' };
        }
        if (p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180) {
            return { error: `waypoint ${index + 1} (${p.lat}, ${p.lon}) is out of range (lat [-90, 90], lon [-180, 180])` };
        }
    }
    const legs = [];
    const zeroLengthLegs = [];
    let cumulative = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
        const from = points[index];
        const to = points[index + 1];
        const distanceKm = haversineKm(from, to, radiusKm);
        cumulative += distanceKm;
        const leg = {
            leg: index + 1,
            fromIndex: index,
            toIndex: index + 1,
            distanceKm,
            cumulativeKm: cumulative,
        };
        if (distanceKm < 1e-9) {
            zeroLengthLegs.push(index + 1);
        }
        else {
            leg.initialBearing = initialBearing(from, to);
            leg.compass = compassPoint(leg.initialBearing);
        }
        legs.push(leg);
    }
    const closureKm = haversineKm(points[points.length - 1], points[0], radiusKm);
    const distances = legs.map((leg) => leg.distanceKm);
    return {
        result: {
            points: points.length,
            legs,
            totalKm: cumulative,
            straightKm: haversineKm(points[0], points[points.length - 1], radiusKm),
            detourKm: cumulative - haversineKm(points[0], points[points.length - 1], radiusKm),
            closureKm,
            closesLoop: closureKm < 1e-9,
            maxLegKm: Math.max(...distances),
            minLegKm: Math.min(...distances),
            zeroLengthLegs,
        },
    };
}
/** A distance this close to a waypoint *is* that waypoint (1 micrometre of arc). */
export const ALONG_EPS_KM = 1e-9;
/** Within this of a pole, the reached point is reported as the pole (1 metre). */
export const POLE_TOL_KM = 1e-3;
/**
 * The inverse of `polylinePath`: instead of totalling a route, walk it.
 *
 * A route bends at its waypoints, so the answer is *not* the direct problem
 * from the origin — the point is found on the containing leg by interpolating
 * its two endpoints on the great circle, and the remaining distance is the
 * rest of that leg plus every leg after it.
 *
 * What is deliberately absent rather than guessed:
 *   - a distance past the route end is an error (clamping would invent a
 *     journey that did not happen);
 *   - a route of zero total length has no fraction (`fraction` absent) and no
 *     heading;
 *   - at a pole the heading is omitted: longitude there is numerical noise,
 *     and the forward-azimuth formula happily returns a course 180° off.
 */
export function alongPath(points, distanceKm, radiusKm = DEFAULT_RADIUS_KM) {
    if (!Number.isFinite(distanceKm))
        return { error: 'distance must be a finite number of kilometres' };
    if (distanceKm < 0)
        return { error: `distance must be zero or positive (got ${distanceKm} km)` };
    const outcome = polylinePath(points, radiusKm);
    if (outcome.error !== undefined)
        return { error: outcome.error };
    const path = outcome.result;
    const totalKm = path.totalKm;
    if (distanceKm > totalKm + ALONG_EPS_KM) {
        return {
            error: `the route is ${totalKm.toFixed(6)} km long, so ${distanceKm.toFixed(6)} km is beyond its end`,
        };
    }
    const target = Math.min(distanceKm, totalKm);
    const first = points[0];
    if (totalKm <= ALONG_EPS_KM) {
        return {
            result: {
                point: { lat: first.lat, lon: first.lon },
                leg: 1,
                fromIndex: 0,
                toIndex: 1,
                points: points.length,
                alongKm: 0,
                totalKm: 0,
                remainingKm: 0,
                legAlongKm: 0,
                legLengthKm: 0,
                legRemainingKm: 0,
                atWaypoint: true,
                waypointIndex: 0,
            },
        };
    }
    const containing = path.legs.find((leg) => leg.cumulativeKm >= target - ALONG_EPS_KM);
    if (containing === undefined)
        return { error: 'internal: no leg contains the requested distance' };
    const legStartCumKm = containing.cumulativeKm - containing.distanceKm;
    const localKm = Math.min(Math.max(target - legStartCumKm, 0), containing.distanceKm);
    const from = points[containing.fromIndex];
    const to = points[containing.toIndex];
    let point;
    let atWaypoint = false;
    let waypointIndex;
    if (containing.distanceKm <= ALONG_EPS_KM || localKm <= ALONG_EPS_KM) {
        point = { lat: from.lat, lon: from.lon };
        atWaypoint = true;
        waypointIndex = containing.fromIndex;
    }
    else if (localKm >= containing.distanceKm - ALONG_EPS_KM) {
        point = { lat: to.lat, lon: to.lon };
        atWaypoint = true;
        waypointIndex = containing.toIndex;
    }
    else {
        const v1 = latLonToXyz(from.lat, from.lon);
        const v2 = latLonToXyz(to.lat, to.lon);
        // The leg length came from the haversine formula, so this angle is the one
        // that makes fraction = 1 land exactly on `to`.
        const angular = containing.distanceKm / radiusKm;
        const sinAngular = Math.sin(angular);
        if (sinAngular < 1e-12) {
            return {
                error: `leg ${containing.leg} joins antipodal waypoints — the great circle between them is not `
                    + 'unique, so there is no single route to walk',
            };
        }
        const fraction = localKm / containing.distanceKm;
        const w1 = Math.sin((1 - fraction) * angular) / sinAngular;
        const w2 = Math.sin(fraction * angular) / sinAngular;
        point = xyzToLatLon({
            x: w1 * v1.x + w2 * v2.x,
            y: w1 * v1.y + w2 * v2.y,
            z: w1 * v1.z + w2 * v2.z,
        });
    }
    const legAhead = path.legs.find((leg) => leg.cumulativeKm > target + ALONG_EPS_KM);
    const poleKm = Math.min(haversineKm(point, { lat: 90, lon: 0 }, radiusKm), haversineKm(point, { lat: -90, lon: 0 }, radiusKm));
    const atPole = poleKm <= POLE_TOL_KM;
    const info = {
        point,
        leg: containing.leg,
        fromIndex: containing.fromIndex,
        toIndex: containing.toIndex,
        points: points.length,
        alongKm: target,
        totalKm,
        remainingKm: totalKm - target,
        fraction: target / totalKm,
        legAlongKm: localKm,
        legLengthKm: containing.distanceKm,
        legRemainingKm: containing.distanceKm - localKm,
        atWaypoint,
    };
    if (atWaypoint)
        info.waypointIndex = waypointIndex;
    if (atPole) {
        info.atPole = true;
    }
    else if (legAhead !== undefined) {
        const heading = initialBearing(point, points[legAhead.toIndex]);
        info.bearing = heading;
        info.compass = compassPoint(heading);
    }
    return { result: info };
}
//# sourceMappingURL=path.js.map