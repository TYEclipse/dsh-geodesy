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
export interface ParsedCoord {
    value: number;
    isLat: boolean;
}
export type CoordKind = 'auto' | 'lat' | 'lon';
/**
 * Parse one coordinate token into decimal degrees. `kindHint` narrows the
 * axis when the token carries no suffix; `suffixAxis` (from pair parsing)
 * takes precedence over the hint.
 */
export declare function parseToken(raw: string, kindHint: CoordKind, suffixAxis?: 'lat' | 'lon'): ParsedCoord | {
    error: string;
};
export interface CoordPair {
    latitude: number;
    longitude: number;
}
/**
 * Parse a full input string: a pair or a single coordinate. Returns a pair
 * with both axes, a single-coordinate result, or an error.
 */
export declare function parseCoordInput(input: string, kind: CoordKind): CoordPair | ParsedCoord | {
    error: string;
};
/** Format both axes of a pair as DMS strings. */
export declare function formatPairDms(lat: number, lon: number): {
    latDms: string;
    lonDms: string;
};
//# sourceMappingURL=coords.d.ts.map