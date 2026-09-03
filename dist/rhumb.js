/**
 * Rhumb-line (loxodrome) math for dsh-geodesy: distance and constant
 * bearing along a line of constant heading — the navigational counterpart
 * to the great-circle tools. Pure trigonometry, zero dependencies.
 *
 * Closed form (standard loxodrome derivations):
 *   dpsi  = ln(tan(pi/4 + lat2/2) / tan(pi/4 + lat1/2))   (meridional parts)
 *   q     = dlat / dpsi, or cos(lat1) when |dpsi| ~ 0      (equal latitudes)
 *   dist  = R * sqrt(dlat^2 + q^2 * dlon^2)
 *   brng  = atan2(dlon, dpsi)
 *
 * @module dsh-geodesy/rhumb
 */
import { DEFAULT_RADIUS_KM } from "./geodesy.js";
const DEG = Math.PI / 180;
/** Rhumb-line (constant-heading) distance in km. */
export function rhumbDistanceKm(a, b, radiusKm = DEFAULT_RADIUS_KM) {
    const la1 = a.lat * DEG;
    const lo1 = a.lon * DEG;
    const la2 = b.lat * DEG;
    const lo2 = b.lon * DEG;
    const dLat = la2 - la1;
    const dLon = lo2 - lo1;
    const dPsi = Math.log(Math.tan(Math.PI / 4 + la2 / 2) / Math.tan(Math.PI / 4 + la1 / 2));
    const q = Math.abs(dPsi) > 1e-12 ? dLat / dPsi : Math.cos(la1);
    return radiusKm * Math.sqrt(dLat * dLat + q * q * dLon * dLon);
}
/**
 * Constant bearing (heading) along the rhumb line from `a` to `b`, in
 * degrees [0, 360). Returns 0 when the two points coincide (no unique
 * heading exists for a zero-length line).
 */
export function rhumbBearing(a, b) {
    const la1 = a.lat * DEG;
    const lo1 = a.lon * DEG;
    const la2 = b.lat * DEG;
    const lo2 = b.lon * DEG;
    const dLon = lo2 - lo1;
    const dPsi = Math.log(Math.tan(Math.PI / 4 + la2 / 2) / Math.tan(Math.PI / 4 + la1 / 2));
    if (la1 === la2 && lo1 === lo2)
        return 0;
    const brng = Math.atan2(dLon, dPsi) / DEG;
    return (brng + 360) % 360;
}
//# sourceMappingURL=rhumb.js.map