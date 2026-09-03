/**
 * dsh-geodesy — geodesic math toolbox for DeepSeek Harness.
 *
 * Seven pure-computation tools, zero runtime dependencies:
 *   geo_distance     — great-circle distance with bearings and compass direction
 *   geo_bearing      — initial/final bearings + great-circle midpoint
 *   geo_destination  — direct problem: point at a bearing and distance
 *   coord_parse      — parse/validate decimal & DMS coordinate strings
 *   geo_rhumb        — constant-heading (rhumb-line) distance and bearing
 *   geo_intersection — crossing of two great-circle paths (+ antipodal crossing)
 *   geo_area         — spherical polygon area and perimeter (spherical excess)
 *
 * All math is spherical trigonometry on a configurable-radius sphere
 * (default IUGG mean Earth radius 6371.0088 km). No network I/O.
 *
 * @module dsh-geodesy
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Stable Cordis plugin name (also the config key under `plugins:`). */
export declare const name = "dsh-geodesy";
/** Services required before tool registration can start. */
export declare const inject: string[];
/** Plugin configuration, resolved with defaults by the loader. */
export interface Config {
    /** Sphere radius in km (default 6371.0088 = IUGG mean Earth radius). */
    radiusKm?: number;
}
export declare const Config: z<Config>;
/** Config with every default resolved (all fields guaranteed). */
export interface ResolvedConfig {
    radiusKm: number;
}
/** Resolve loader config into the effective runtime config. */
export declare function resolveConfig(config: Config): ResolvedConfig;
/** Mount the geodesy tools on every live agent and every future one. */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map