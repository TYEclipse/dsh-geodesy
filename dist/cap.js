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
import { DEFAULT_RADIUS_KM, haversineKm } from "./geodesy.js";
const DEG = Math.PI / 180;
/** Arc tolerance for "on the boundary": 1e-9 rad ≈ 6 mm on an Earth-sized sphere. */
export const BOUNDARY_TOL_RAD = 1e-9;
/** Normalise a longitude into [-180, 180). */
function normalizeLon(lon) {
    return ((lon + 540) % 360) - 180;
}
/**
 * Every quantity the `geo_circle` tool reports, for a cap of `radiusKm`
 * around `center` on a sphere of `sphereRadiusKm`. Pass `point` to also get
 * the containment verdict for that point.
 */
export function sphericalCap(center, radiusKm, sphereRadiusKm = DEFAULT_RADIUS_KM, point) {
    if (!Number.isFinite(radiusKm)) {
        return { error: 'cap radius must be a finite number of km' };
    }
    if (radiusKm <= 0) {
        return { error: 'cap radius must be positive — a zero-radius cap is a single point, not an area' };
    }
    const halfCircumferenceKm = Math.PI * sphereRadiusKm;
    const angular = Math.min(radiusKm / sphereRadiusKm, Math.PI);
    const angularRadiusDeg = angular / DEG;
    const coversWholeSphere = radiusKm >= halfCircumferenceKm * (1 - 1e-12);
    const areaKm2 = 2 * Math.PI * sphereRadiusKm ** 2 * (1 - Math.cos(angular));
    const surfaceFraction = areaKm2 / (4 * Math.PI * sphereRadiusKm ** 2);
    const boundaryKm = 2 * Math.PI * sphereRadiusKm * Math.sin(angular);
    const boundaryIsGreatCircle = Math.abs(angular - Math.PI / 2) < 1e-12;
    const latMaxRaw = center.lat + angularRadiusDeg;
    const latMinRaw = center.lat - angularRadiusDeg;
    const includesNorthPole = latMaxRaw >= 90 - 1e-12;
    const includesSouthPole = latMinRaw <= -90 + 1e-12;
    const maxLat = Math.min(90, latMaxRaw);
    const minLat = Math.max(-90, latMinRaw);
    let minLon = -180;
    let maxLon = 180;
    let lonSpanDeg = 360;
    let crossesAntimeridian = false;
    let coversAllLongitudes = coversWholeSphere || includesNorthPole || includesSouthPole;
    if (!coversAllLongitudes) {
        // While the cap stays clear of both poles this ratio is < 1 and the
        // longitude half-span is well defined; hitting 1 exactly means the cap
        // reaches a pole (the same case the pole tests above already caught).
        const ratio = Math.sin(angular) / Math.cos(center.lat * DEG);
        if (!(Math.abs(ratio) < 1 - 1e-12)) {
            coversAllLongitudes = true;
        }
        else if (Math.abs(ratio) < 1e-15) {
            lonSpanDeg = 0;
            minLon = center.lon;
            maxLon = center.lon;
        }
        else {
            const delta = Math.asin(ratio) / DEG;
            lonSpanDeg = 2 * delta;
            const west = center.lon - delta;
            const east = center.lon + delta;
            crossesAntimeridian = west < -180 || east > 180;
            if (crossesAntimeridian) {
                minLon = normalizeLon(west);
                maxLon = normalizeLon(east);
            }
            else {
                minLon = west;
                maxLon = east;
            }
        }
    }
    const result = {
        angularRadiusDeg,
        areaKm2,
        surfaceFraction,
        boundaryKm,
        boundaryIsGreatCircle,
        minLat,
        maxLat,
        minLon,
        maxLon,
        lonSpanDeg,
        crossesAntimeridian,
        coversAllLongitudes,
        includesNorthPole,
        includesSouthPole,
        coversWholeSphere,
    };
    if (point !== undefined) {
        const distance = haversineKm(center, point, sphereRadiusKm);
        const tol = BOUNDARY_TOL_RAD * sphereRadiusKm;
        const onBoundary = Math.abs(distance - radiusKm) <= tol;
        result.pointDistanceKm = distance;
        result.pointOnBoundary = onBoundary;
        result.containsPoint = !onBoundary && distance <= radiusKm + tol;
    }
    return { result };
}
//# sourceMappingURL=cap.js.map