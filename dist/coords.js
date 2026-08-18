/**
 * Coordinate string parsing for dsh-geodesy: decimal and DMS notations,
 * compass suffixes, pair detection, range validation.
 *
 * Deterministic rules (documented in the README):
 * - comma-separated input is always a "lat, lon" pair
 * - two whitespace-separated tokens form a pair when at least one carries a
 *   N/S/E/W suffix; axes come from suffixes, positional fallback is lat, lon
 * - everything else is a single coordinate token: decimal ("37.775", "-122.419°"),
 *   DMS with symbols ("37°46′30″N"), letters ("37d46m30sN"), colons ("37:46:30N")
 *   or plain numbers ("37 46 30 N", "37 46.5")
 *
 * @module dsh-geodesy/coords
 */
import { formatDms } from "./geodesy.js";
const DECIMAL_RE = /^([+-]?\d+(?:\.\d+)?)\s*°?\s*([NSEWnsew])?$/;
const DMS_RE = /^(\d{1,3})\s*[°ºd:]?\s*(\d{1,2}(?:\.\d+)?)\s*[′'m:]?\s*(?:(\d{1,2}(?:\.\d+)?)\s*[″"s:]?)?\s*([NSEWnsew])?$/;
function axisOfSuffix(suffix) {
    if (suffix === undefined)
        return undefined;
    const upper = suffix.toUpperCase();
    if (upper === 'N' || upper === 'S')
        return 'lat';
    if (upper === 'E' || upper === 'W')
        return 'lon';
    return undefined;
}
function signOfSuffix(suffix) {
    const upper = suffix === undefined ? '' : suffix.toUpperCase();
    if (upper === 'S' || upper === 'W')
        return -1;
    return 1;
}
function error(message) {
    return { error: message };
}
function checkRange(value, isLat) {
    const limit = isLat ? 90 : 180;
    if (value < -limit || value > limit) {
        return `${isLat ? 'latitude' : 'longitude'} ${value} is out of range [${-limit}, ${limit}]`;
    }
    return undefined;
}
/**
 * Parse one coordinate token into decimal degrees. `kindHint` narrows the
 * axis when the token carries no suffix; `suffixAxis` (from pair parsing)
 * takes precedence over the hint.
 */
export function parseToken(raw, kindHint, suffixAxis) {
    const token = raw.trim();
    let decimal = DECIMAL_RE.exec(token);
    let dms = null;
    if (decimal === null)
        dms = DMS_RE.exec(token);
    if (decimal !== null) {
        const numberPart = decimal[1] ?? '';
        const suffix = decimal[2] ?? undefined;
        const magnitude = Number.parseFloat(numberPart);
        if (suffix !== undefined && (suffix.toUpperCase() === 'S' || suffix.toUpperCase() === 'W') && numberPart.startsWith('-')) {
            return error(`conflicting sign in "${token}": a minus sign combined with ${suffix.toUpperCase()} suffix`);
        }
        const value = suffix === undefined ? magnitude : signOfSuffix(suffix) * Math.abs(magnitude);
        return finish(value, suffix, kindHint, suffixAxis, token);
    }
    if (dms !== null) {
        const degPart = dms[1] ?? '';
        const minPart = dms[2] ?? '';
        const secPart = dms[3];
        const suffix = dms[4] ?? undefined;
        const deg = Number.parseInt(degPart, 10);
        const min = Number.parseFloat(minPart);
        if (min >= 60)
            return error(`invalid minutes ${minPart} in "${token}" (must be < 60)`);
        let seconds = 0;
        if (secPart !== undefined) {
            seconds = Number.parseFloat(secPart);
            if (seconds >= 60)
                return error(`invalid seconds ${secPart} in "${token}" (must be < 60)`);
        }
        const magnitude = deg + min / 60 + seconds / 3600;
        const value = signOfSuffix(suffix) * magnitude;
        return finish(value, suffix, kindHint, suffixAxis, token);
    }
    return error(`cannot parse "${token}" — expected a decimal coordinate (e.g. 37.775, -122.419), a DMS coordinate (e.g. 37°46′30″N, 37:46:30, "37 46 30 N") or a "lat, lon" pair`);
}
function finish(value, suffix, kindHint, suffixAxis, token) {
    const fromSuffix = axisOfSuffix(suffix);
    let axis;
    if (suffixAxis !== undefined) {
        if (fromSuffix !== undefined && fromSuffix !== suffixAxis) {
            return error(`suffix ${suffix.toUpperCase()} conflicts with the expected ${suffixAxis} axis in "${token}"`);
        }
        axis = suffixAxis;
    }
    else if (fromSuffix !== undefined) {
        axis = fromSuffix;
    }
    else if (kindHint === 'lat' || kindHint === 'lon') {
        axis = kindHint;
    }
    else {
        return error(`cannot determine the axis of "${token}" — add a N/S/E/W suffix or pass kind "lat" or "lon"`);
    }
    const rangeError = checkRange(value, axis === 'lat');
    if (rangeError !== undefined)
        return error(rangeError);
    return { value, isLat: axis === 'lat' };
}
/**
 * Parse a full input string: a pair or a single coordinate. Returns a pair
 * with both axes, a single-coordinate result, or an error.
 */
export function parseCoordInput(input, kind) {
    const trimmed = input.trim();
    const commaParts = trimmed.split(',').map((part) => part.trim());
    if (commaParts.length === 2) {
        return parseOrderedPair(commaParts[0] ?? '', commaParts[1] ?? '', trimmed);
    }
    if (commaParts.length > 2) {
        return error(`expected one or two comma-separated coordinates, got ${commaParts.length} in "${trimmed}"`);
    }
    const spaceParts = trimmed.split(/\s+/);
    if (spaceParts.length === 2) {
        const firstHasSuffix = /[NSEWnsew]$/.test(spaceParts[0] ?? '');
        const secondHasSuffix = /[NSEWnsew]$/.test(spaceParts[1] ?? '');
        if (firstHasSuffix || secondHasSuffix) {
            return parseOrderedPair(spaceParts[0] ?? '', spaceParts[1] ?? '', trimmed);
        }
    }
    const single = parseToken(trimmed, kind);
    if ('error' in single)
        return single;
    return single;
}
function parseOrderedPair(first, second, original) {
    const firstSuffix = first.match(/[NSEWnsew]$/)?.[0];
    const secondSuffix = second.match(/[NSEWnsew]$/)?.[0];
    const firstAxis = axisOfSuffix(firstSuffix);
    const secondAxis = axisOfSuffix(secondSuffix);
    let latToken;
    let lonToken;
    if (firstAxis !== undefined && secondAxis !== undefined) {
        if (firstAxis === secondAxis) {
            return error(`both parts of "${original}" are on the ${firstAxis} axis — expected one latitude and one longitude`);
        }
        latToken = firstAxis === 'lat' ? first : second;
        lonToken = firstAxis === 'lon' ? first : second;
    }
    else if (firstAxis !== undefined) {
        latToken = firstAxis === 'lat' ? first : second;
        lonToken = firstAxis === 'lon' ? first : second;
    }
    else if (secondAxis !== undefined) {
        latToken = secondAxis === 'lat' ? second : first;
        lonToken = secondAxis === 'lon' ? second : first;
    }
    else {
        latToken = first;
        lonToken = second;
    }
    const lat = parseToken(latToken, 'auto', 'lat');
    if ('error' in lat)
        return lat;
    const lon = parseToken(lonToken, 'auto', 'lon');
    if ('error' in lon)
        return lon;
    return { latitude: lat.value, longitude: lon.value };
}
/** Format both axes of a pair as DMS strings. */
export function formatPairDms(lat, lon) {
    return { latDms: formatDms(lat, true), lonDms: formatDms(lon, false) };
}
//# sourceMappingURL=coords.js.map