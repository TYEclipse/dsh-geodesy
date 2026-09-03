/**
 * Tool definitions for dsh-geodesy: four pure-math tools exposed to every
 * agent via defineTool. Each tool has a strict JSON-schema parameter
 * surface and a compact text renderer. No network I/O happens anywhere.
 *
 * @module dsh-geodesy/tools
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { ResolvedConfig } from './index.ts';
export interface ToolSet {
    geo_distance: ToolDefinition;
    geo_bearing: ToolDefinition;
    geo_destination: ToolDefinition;
    coord_parse: ToolDefinition;
    geo_rhumb: ToolDefinition;
    geo_intersection: ToolDefinition;
    geo_area: ToolDefinition;
}
/** Full output of geo_distance: success keys always present, `reason` only on failure. */
export interface DistanceResult {
    valid: boolean;
    unit?: string;
    distance?: number;
    kilometers?: number;
    miles?: number;
    nauticalMiles?: number;
    initialBearing?: number;
    finalBearing?: number;
    compass?: string;
    reason?: string;
}
/** Full output of geo_bearing. */
export interface BearingResult {
    valid: boolean;
    initialBearing?: number;
    finalBearing?: number;
    compass?: string;
    midpointLat?: number;
    midpointLon?: number;
    reason?: string;
}
/** Full output of geo_destination. */
export interface DestinationResult {
    valid: boolean;
    lat?: number;
    lon?: number;
    latDms?: string;
    lonDms?: string;
    checkDistanceKm?: number;
    reason?: string;
}
/** Full output of coord_parse. */
export interface CoordParseResult {
    valid: boolean;
    input: string;
    latitude?: number;
    longitude?: number;
    latDms?: string;
    lonDms?: string;
    error?: string;
}
/** Full output of geo_rhumb. */
export interface RhumbResult {
    valid: boolean;
    unit?: string;
    distance?: number;
    kilometers?: number;
    miles?: number;
    nauticalMiles?: number;
    bearing?: number;
    compass?: string;
    greatCircleKm?: number;
    note?: string;
    reason?: string;
}
/** Full output of geo_intersection. */
export interface IntersectionToolResult {
    valid: boolean;
    lat?: number;
    lon?: number;
    distanceFromStart1Km?: number;
    distanceFromStart2Km?: number;
    antipodeLat?: number;
    antipodeLon?: number;
    antipodeDistanceFromStart1Km?: number;
    antipodeDistanceFromStart2Km?: number;
    note?: string;
    reason?: string;
}
/** Full output of geo_area. */
export interface AreaToolResult {
    valid: boolean;
    vertices?: number;
    areaKm2?: number;
    perimeterKm?: number;
    excessRadians?: number;
    complementKm2?: number;
    note?: string;
    reason?: string;
}
/** Build all seven tool definitions from the resolved config. */
export declare function buildGeodesyTools(config: ResolvedConfig): ToolSet;
//# sourceMappingURL=tools.d.ts.map