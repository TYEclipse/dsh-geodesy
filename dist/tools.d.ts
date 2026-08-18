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
/** Build all four tool definitions from the resolved config. */
export declare function buildGeodesyTools(config: ResolvedConfig): ToolSet;
//# sourceMappingURL=tools.d.ts.map