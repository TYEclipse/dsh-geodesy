/**
 * Core geodesic math for dsh-geodesy: great-circle (spherical) geometry on a
 * sphere of configurable radius. Pure trigonometry, zero dependencies.
 *
 * Formulas follow the standard spherical-haversine and direct-problem
 * derivations (Movable Type Scripts conventions, IUGG mean Earth radius).
 * All angles are decimal degrees externally, radians internally.
 *
 * @module dsh-geodesy/geodesy
 */
export const DEFAULT_RADIUS_KM = 6371.0088; // IUGG mean Earth radius
/** Distance units, expressed as units per kilometre. */
export const UNIT_FACTORS = {
    km: 1,
    m: 1000,
    mi: 1 / 1.609344,
    nmi: 1 / 1.852,
};
export const DISTANCE_UNITS = ['km', 'm', 'mi', 'nmi'];
const DEG = Math.PI / 180;
/** Round to `digits` decimal places (kills floating-point dust for output). */
export function round(value, digits = 6) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
/** Validate a lat/lon pair; returns an error string or undefined when valid. */
export function validatePoint(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return 'latitude and longitude must be finite numbers';
    }
    if (lat < -90 || lat > 90)
        return `latitude ${lat} is out of range [-90, 90]`;
    if (lon < -180 || lon > 180)
        return `longitude ${lon} is out of range [-180, 180]`;
    return undefined;
}
/** Great-circle distance in km via the haversine formula. */
export function haversineKm(a, b, radiusKm = DEFAULT_RADIUS_KM) {
    const la1 = a.lat * DEG;
    const lo1 = a.lon * DEG;
    const la2 = b.lat * DEG;
    const lo2 = b.lon * DEG;
    const dLa = la2 - la1;
    const dLo = lo2 - lo1;
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
    return 2 * radiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Initial bearing (forward azimuth) from `a` to `b` in degrees [0, 360). */
export function initialBearing(a, b) {
    const la1 = a.lat * DEG;
    const lo1 = a.lon * DEG;
    const la2 = b.lat * DEG;
    const lo2 = b.lon * DEG;
    const dLo = lo2 - lo1;
    const y = Math.sin(dLo) * Math.cos(la2);
    const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLo);
    return (Math.atan2(y, x) / DEG + 360) % 360;
}
/** Final bearing: the heading on arrival, i.e. the reverse of b→a's initial bearing. */
export function finalBearing(a, b) {
    return (initialBearing(b, a) + 180) % 360;
}
/** Direct problem: destination point given start, bearing and great-circle distance. */
export function destinationPoint(start, bearingDeg, distanceKm, radiusKm = DEFAULT_RADIUS_KM) {
    const la1 = start.lat * DEG;
    const lo1 = start.lon * DEG;
    const th = bearingDeg * DEG;
    const d = distanceKm / radiusKm;
    const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(th));
    const lo2 = lo1
        + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
    return { lat: la2 / DEG, lon: ((lo2 / DEG + 540) % 360) - 180 };
}
/** Half-way point along the great circle between `a` and `b`. */
export function midpointOf(a, b) {
    const la1 = a.lat * DEG;
    const lo1 = a.lon * DEG;
    const la2 = b.lat * DEG;
    const lo2 = b.lon * DEG;
    const dLo = lo2 - lo1;
    const bx = Math.cos(la2) * Math.cos(dLo);
    const by = Math.cos(la2) * Math.sin(dLo);
    const la3 = Math.atan2(Math.sin(la1) + Math.sin(la2), Math.sqrt((Math.cos(la1) + bx) ** 2 + by ** 2));
    const lo3 = lo1 + Math.atan2(by, Math.cos(la1) + bx);
    return { lat: la3 / DEG, lon: ((lo3 / DEG + 540) % 360) - 180 };
}
const COMPASS_16 = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];
/** Sixteen-wind compass point for a bearing in degrees. */
export function compassPoint(bearingDeg) {
    const idx = Math.floor((((bearingDeg % 360) + 360) % 360 + 11.25) / 22.5) % 16;
    return COMPASS_16[idx] ?? 'N';
}
/** Format decimal degrees as DMS with a direction suffix (N/S/E/W). */
export function formatDms(decimalDeg, isLat) {
    const dir = isLat ? (decimalDeg >= 0 ? 'N' : 'S') : (decimalDeg >= 0 ? 'E' : 'W');
    const abs = Math.abs(decimalDeg);
    let deg = Math.floor(abs);
    const rest = (abs - deg) * 60;
    let min = Math.floor(rest + 1e-9);
    // (rest - min) is fractional minutes; ×600 = ×60 (to seconds) ×10 (1-decimal rounding)
    let sec = Math.round((rest - min) * 600) / 10;
    if (sec >= 60) {
        sec -= 60;
        min += 1;
    }
    if (min >= 60) {
        min -= 60;
        deg += 1;
    }
    const secStr = Number.isInteger(sec) ? String(sec) : sec.toFixed(1);
    return `${deg}°${min}′${secStr}″${dir}`;
}
//# sourceMappingURL=geodesy.js.map