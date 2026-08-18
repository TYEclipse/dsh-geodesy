/**
 * dsh-geodesy — geodesic math toolbox for DeepSeek Harness.
 *
 * Four pure-computation tools, zero runtime dependencies:
 *   geo_distance    — great-circle distance with bearings and compass direction
 *   geo_bearing     — initial/final bearings + great-circle midpoint
 *   geo_destination — direct problem: point at a bearing and distance
 *   coord_parse     — parse/validate decimal & DMS coordinate strings
 *
 * All math is spherical trigonometry on a configurable-radius sphere
 * (default IUGG mean Earth radius 6371.0088 km). No network I/O.
 *
 * @module dsh-geodesy
 */
import z from '@deepseek-ai/schemastery';
import { DEFAULT_RADIUS_KM } from "./geodesy.js";
import { buildGeodesyTools } from "./tools.js";
/** Stable Cordis plugin name (also the config key under `plugins:`). */
export const name = 'dsh-geodesy';
/** Services required before tool registration can start. */
export const inject = ['agents', 'tools'];
export const Config = z.object({
    radiusKm: z.number().min(1000).max(100_000).default(DEFAULT_RADIUS_KM),
});
/** Resolve loader config into the effective runtime config. */
export function resolveConfig(config) {
    return {
        radiusKm: config.radiusKm ?? DEFAULT_RADIUS_KM,
    };
}
/** Register every geodesy tool on one agent; returns the disposer. */
function decorate(agent, tools) {
    const disposers = Object.values(tools).map((definition) => agent.ctx.tools.register(definition));
    return () => {
        for (const dispose of disposers) {
            try {
                dispose();
            }
            catch {
                // already disposed
            }
        }
    };
}
/** Mount the geodesy tools on every live agent and every future one. */
export function apply(ctx, config) {
    const resolved = resolveConfig(config);
    const tools = buildGeodesyTools(resolved);
    const disposers = new Set();
    const decorateAgent = (agent) => {
        try {
            disposers.add(decorate(agent, tools));
        }
        catch (error) {
            ctx.logger('geodesy').warn(`tool registration for agent ${agent.id} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    for (const agent of ctx.agents.list())
        decorateAgent(agent);
    const off = ctx.on('agent/created', ({ agent }) => decorateAgent(agent));
    ctx.effect(() => () => {
        off();
        for (const dispose of disposers) {
            try {
                dispose();
            }
            catch {
                // already disposed
            }
        }
        disposers.clear();
    });
}
//# sourceMappingURL=index.js.map