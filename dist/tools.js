/**
 * Tool definitions for dsh-geodesy: four pure-math tools exposed to every
 * agent via defineTool. Each tool has a strict JSON-schema parameter
 * surface and a compact text renderer. No network I/O happens anywhere.
 *
 * @module dsh-geodesy/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { DISTANCE_UNITS, UNIT_FACTORS, compassPoint, destinationPoint, finalBearing, formatDms, haversineKm, initialBearing, midpointOf, round, validatePoint, } from "./geodesy.js";
import { parseCoordInput } from "./coords.js";
function renderDistance(value) {
    const result = value;
    if (!result.valid)
        return `invalid input: ${result.reason ?? 'unknown error'}`;
    return `${result.distance} ${result.unit} (${result.kilometers} km · ${result.miles} mi)` +
        ` — initial bearing ${result.initialBearing}° (${result.compass}), final bearing ${result.finalBearing}°`;
}
function renderBearing(value) {
    const result = value;
    if (!result.valid)
        return `invalid input: ${result.reason ?? 'unknown error'}`;
    return `initial bearing ${result.initialBearing}° (${result.compass}), final bearing ${result.finalBearing}°` +
        ` — midpoint ${result.midpointLat}, ${result.midpointLon}`;
}
function renderDestination(value) {
    const result = value;
    if (!result.valid)
        return `invalid input: ${result.reason ?? 'unknown error'}`;
    return `destination: ${result.lat}, ${result.lon} (${result.latDms}, ${result.lonDms})` +
        ` — round-trip check: ${result.checkDistanceKm} km`;
}
function renderCoord(value) {
    const result = value;
    if (!result.valid)
        return `"${result.input}" is not a valid coordinate: ${result.error ?? 'unknown error'}`;
    const parts = [];
    if (result.latitude !== undefined)
        parts.push(`lat ${result.latitude} (${result.latDms})`);
    if (result.longitude !== undefined)
        parts.push(`lon ${result.longitude} (${result.lonDms})`);
    return `"${result.input}" → ${parts.join(', ')}`;
}
/** Build all four tool definitions from the resolved config. */
export function buildGeodesyTools(config) {
    const radiusKm = config.radiusKm;
    const maxDistanceKm = Math.PI * radiusKm;
    const geo_distance = defineTool({
        name: 'geo_distance',
        description: 'Compute the great-circle distance between two points given as decimal-degree latitude/longitude '
            + `(Earth mean radius ${radiusKm} km). Returns the distance in km/m/mi/nmi plus the initial and final `
            + 'bearings and the compass direction. Never estimate great-circle distances by mental math — use this instead.',
        parameters: {
            lat1: { type: 'number', required: true, description: 'Latitude of the first point, -90 to 90.' },
            lon1: { type: 'number', required: true, description: 'Longitude of the first point, -180 to 180.' },
            lat2: { type: 'number', required: true, description: 'Latitude of the second point, -90 to 90.' },
            lon2: { type: 'number', required: true, description: 'Longitude of the second point, -180 to 180.' },
            unit: { type: 'string', enum: [...DISTANCE_UNITS], description: 'Distance unit (default km).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    valid: { type: 'boolean', required: true },
                    unit: { type: 'string' },
                    distance: { type: 'number' },
                    kilometers: { type: 'number' },
                    miles: { type: 'number' },
                    nauticalMiles: { type: 'number' },
                    initialBearing: { type: 'number' },
                    finalBearing: { type: 'number' },
                    compass: { type: 'string' },
                    reason: { type: 'string' },
                },
            },
            render: (_args, value) => [{ type: 'text', text: renderDistance(value) }],
        },
        async execute(args) {
            const unit = args.unit ?? 'km';
            if (UNIT_FACTORS[unit] === undefined) {
                return { valid: false, reason: `unsupported unit "${unit}" (expected km, m, mi or nmi)` };
            }
            const reason = validatePoint(args.lat1, args.lon1) ?? validatePoint(args.lat2, args.lon2);
            if (reason !== undefined)
                return { valid: false, reason };
            const a = { lat: args.lat1, lon: args.lon1 };
            const b = { lat: args.lat2, lon: args.lon2 };
            const km = haversineKm(a, b, radiusKm);
            const factor = UNIT_FACTORS[unit] ?? 1;
            const initial = initialBearing(a, b);
            return {
                valid: true,
                unit,
                distance: round(km * factor),
                kilometers: round(km),
                miles: round(km / 1.609344),
                nauticalMiles: round(km / 1.852),
                initialBearing: round(initial),
                finalBearing: round(finalBearing(a, b)),
                compass: compassPoint(initial),
            };
        },
    });
    const geo_bearing = defineTool({
        name: 'geo_bearing',
        description: 'Compute the initial and final great-circle bearings from one decimal-degree point to another, '
            + 'the 16-wind compass direction, and the great-circle midpoint. Useful for "which direction is X from Y" '
            + 'and for route planning.',
        parameters: {
            lat1: { type: 'number', required: true, description: 'Latitude of the start point, -90 to 90.' },
            lon1: { type: 'number', required: true, description: 'Longitude of the start point, -180 to 180.' },
            lat2: { type: 'number', required: true, description: 'Latitude of the end point, -90 to 90.' },
            lon2: { type: 'number', required: true, description: 'Longitude of the end point, -180 to 180.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    valid: { type: 'boolean', required: true },
                    initialBearing: { type: 'number' },
                    finalBearing: { type: 'number' },
                    compass: { type: 'string' },
                    midpointLat: { type: 'number' },
                    midpointLon: { type: 'number' },
                    reason: { type: 'string' },
                },
            },
            render: (_args, value) => [{ type: 'text', text: renderBearing(value) }],
        },
        async execute(args) {
            const reason = validatePoint(args.lat1, args.lon1) ?? validatePoint(args.lat2, args.lon2);
            if (reason !== undefined)
                return { valid: false, reason };
            const a = { lat: args.lat1, lon: args.lon1 };
            const b = { lat: args.lat2, lon: args.lon2 };
            const initial = initialBearing(a, b);
            const midpoint = midpointOf(a, b);
            return {
                valid: true,
                initialBearing: round(initial),
                finalBearing: round(finalBearing(a, b)),
                compass: compassPoint(initial),
                midpointLat: round(midpoint.lat),
                midpointLon: round(midpoint.lon),
            };
        },
    });
    const geo_destination = defineTool({
        name: 'geo_destination',
        description: 'Solve the direct geodesic problem: given a starting point, an initial bearing (0-360, clockwise '
            + 'from north) and a distance, compute the destination point on the sphere (with a round-trip distance check). '
            + 'Useful for "what is 50 km due east of X" or drawing range circles.',
        parameters: {
            lat: { type: 'number', required: true, description: 'Latitude of the start point, -90 to 90.' },
            lon: { type: 'number', required: true, description: 'Longitude of the start point, -180 to 180.' },
            bearing: { type: 'number', required: true, description: 'Initial bearing in degrees, 0 to 360 (0 = north, 90 = east).' },
            distance: { type: 'number', required: true, description: `Distance to travel, > 0 and at most half the circumference (${round(maxDistanceKm, 2)} km).` },
            unit: { type: 'string', enum: [...DISTANCE_UNITS], description: 'Unit of the distance (default km).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    valid: { type: 'boolean', required: true },
                    lat: { type: 'number' },
                    lon: { type: 'number' },
                    latDms: { type: 'string' },
                    lonDms: { type: 'string' },
                    checkDistanceKm: { type: 'number' },
                    reason: { type: 'string' },
                },
            },
            render: (_args, value) => [{ type: 'text', text: renderDestination(value) }],
        },
        async execute(args) {
            const pointReason = validatePoint(args.lat, args.lon);
            if (pointReason !== undefined)
                return { valid: false, reason: pointReason };
            if (!Number.isFinite(args.bearing) || args.bearing < 0 || args.bearing >= 360) {
                return { valid: false, reason: `bearing ${args.bearing} is out of range [0, 360)` };
            }
            const unit = args.unit ?? 'km';
            if (UNIT_FACTORS[unit] === undefined) {
                return { valid: false, reason: `unsupported unit "${unit}" (expected km, m, mi or nmi)` };
            }
            const factor = UNIT_FACTORS[unit] ?? 1;
            const km = args.distance / factor;
            if (!Number.isFinite(km) || km < 0) {
                return { valid: false, reason: `distance must be a non-negative number` };
            }
            if (km > maxDistanceKm) {
                return { valid: false, reason: `distance ${round(km, 2)} km exceeds half the sphere circumference (${round(maxDistanceKm, 2)} km)` };
            }
            const start = { lat: args.lat, lon: args.lon };
            const dest = destinationPoint(start, args.bearing, km, radiusKm);
            return {
                valid: true,
                lat: round(dest.lat),
                lon: round(dest.lon),
                latDms: formatDms(dest.lat, true),
                lonDms: formatDms(dest.lon, false),
                checkDistanceKm: round(haversineKm(start, dest, radiusKm)),
            };
        },
    });
    const coord_parse = defineTool({
        name: 'coord_parse',
        description: 'Parse and validate latitude/longitude strings in decimal or DMS notation (with N/S/E/W suffixes) '
            + 'and convert them to decimal degrees plus formatted DMS. Accepts "lat, lon" pairs, single coordinates with a '
            + 'kind hint, DMS like 37°46′30″N or "37 46 30 N", and colons like 37:46:30N. Never convert DMS by hand — '
            + 'use this instead.',
        parameters: {
            value: { type: 'string', required: true, description: 'Coordinate string: a pair like "39.9042, 116.4074" or "39°54′15″N 116°23′27″E", or a single coordinate like "37°46′30″N".' },
            kind: { type: 'string', enum: ['auto', 'lat', 'lon'], description: 'Axis hint for a single unsuffixed coordinate (default auto).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    valid: { type: 'boolean', required: true },
                    input: { type: 'string', required: true },
                    latitude: { type: 'number' },
                    longitude: { type: 'number' },
                    latDms: { type: 'string' },
                    lonDms: { type: 'string' },
                    error: { type: 'string' },
                },
            },
            render: (_args, value) => [{ type: 'text', text: renderCoord(value) }],
        },
        async execute(args) {
            const kind = (args.kind ?? 'auto');
            if (kind !== 'auto' && kind !== 'lat' && kind !== 'lon') {
                return { valid: false, input: args.value, error: `unsupported kind "${kind}" (expected auto, lat or lon)` };
            }
            const parsed = parseCoordInput(args.value, kind);
            if ('error' in parsed) {
                return { valid: false, input: args.value, error: parsed.error };
            }
            if ('value' in parsed) {
                const isLat = parsed.isLat;
                const result = { valid: true, input: args.value };
                if (isLat) {
                    result.latitude = round(parsed.value);
                    result.latDms = formatDms(parsed.value, true);
                }
                else {
                    result.longitude = round(parsed.value);
                    result.lonDms = formatDms(parsed.value, false);
                }
                return result;
            }
            const pair = parsed;
            return {
                valid: true,
                input: args.value,
                latitude: round(pair.latitude),
                longitude: round(pair.longitude),
                latDms: formatDms(pair.latitude, true),
                lonDms: formatDms(pair.longitude, false),
            };
        },
    });
    return { geo_distance, geo_bearing, geo_destination, coord_parse };
}
//# sourceMappingURL=tools.js.map