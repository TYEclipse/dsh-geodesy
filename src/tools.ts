/**
 * Tool definitions for dsh-geodesy: four pure-math tools exposed to every
 * agent via defineTool. Each tool has a strict JSON-schema parameter
 * surface and a compact text renderer. No network I/O happens anywhere.
 *
 * @module dsh-geodesy/tools
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  DISTANCE_UNITS,
  UNIT_FACTORS,
  compassPoint,
  destinationPoint,
  finalBearing,
  formatDms,
  haversineKm,
  initialBearing,
  midpointOf,
  round,
  validatePoint,
} from './geodesy.ts'
import { parseCoordInput, type CoordKind } from './coords.ts'
import type { ResolvedConfig } from './index.ts'

export interface ToolSet {
  geo_distance: ToolDefinition
  geo_bearing: ToolDefinition
  geo_destination: ToolDefinition
  coord_parse: ToolDefinition
}

/** Full output of geo_distance: success keys always present, `reason` only on failure. */
export interface DistanceResult {
  valid: boolean
  unit?: string
  distance?: number
  kilometers?: number
  miles?: number
  nauticalMiles?: number
  initialBearing?: number
  finalBearing?: number
  compass?: string
  reason?: string
}

/** Full output of geo_bearing. */
export interface BearingResult {
  valid: boolean
  initialBearing?: number
  finalBearing?: number
  compass?: string
  midpointLat?: number
  midpointLon?: number
  reason?: string
}

/** Full output of geo_destination. */
export interface DestinationResult {
  valid: boolean
  lat?: number
  lon?: number
  latDms?: string
  lonDms?: string
  checkDistanceKm?: number
  reason?: string
}

/** Full output of coord_parse. */
export interface CoordParseResult {
  valid: boolean
  input: string
  latitude?: number
  longitude?: number
  latDms?: string
  lonDms?: string
  error?: string
}

function renderDistance(value: unknown): string {
  const result = value as DistanceResult
  if (!result.valid) return `invalid input: ${result.reason ?? 'unknown error'}`
  return `${result.distance} ${result.unit} (${result.kilometers} km · ${result.miles} mi)` +
    ` — initial bearing ${result.initialBearing}° (${result.compass}), final bearing ${result.finalBearing}°`
}

function renderBearing(value: unknown): string {
  const result = value as BearingResult
  if (!result.valid) return `invalid input: ${result.reason ?? 'unknown error'}`
  return `initial bearing ${result.initialBearing}° (${result.compass}), final bearing ${result.finalBearing}°` +
    ` — midpoint ${result.midpointLat}, ${result.midpointLon}`
}

function renderDestination(value: unknown): string {
  const result = value as DestinationResult
  if (!result.valid) return `invalid input: ${result.reason ?? 'unknown error'}`
  return `destination: ${result.lat}, ${result.lon} (${result.latDms}, ${result.lonDms})` +
    ` — round-trip check: ${result.checkDistanceKm} km`
}

function renderCoord(value: unknown): string {
  const result = value as CoordParseResult
  if (!result.valid) return `"${result.input}" is not a valid coordinate: ${result.error ?? 'unknown error'}`
  const parts: string[] = []
  if (result.latitude !== undefined) parts.push(`lat ${result.latitude} (${result.latDms})`)
  if (result.longitude !== undefined) parts.push(`lon ${result.longitude} (${result.lonDms})`)
  return `"${result.input}" → ${parts.join(', ')}`
}

/** Build all four tool definitions from the resolved config. */
export function buildGeodesyTools(config: ResolvedConfig): ToolSet {
  const radiusKm = config.radiusKm
  const maxDistanceKm = Math.PI * radiusKm

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
      render: (_args: { lat1: number; lon1: number; lat2: number; lon2: number; unit?: string }, value: unknown) =>
        [{ type: 'text', text: renderDistance(value) }],
    },
    async execute(args: { lat1: number; lon1: number; lat2: number; lon2: number; unit?: string }): Promise<DistanceResult> {
      const unit = args.unit ?? 'km'
      if (UNIT_FACTORS[unit] === undefined) {
        return { valid: false, reason: `unsupported unit "${unit}" (expected km, m, mi or nmi)` }
      }
      const reason = validatePoint(args.lat1, args.lon1) ?? validatePoint(args.lat2, args.lon2)
      if (reason !== undefined) return { valid: false, reason }
      const a = { lat: args.lat1, lon: args.lon1 }
      const b = { lat: args.lat2, lon: args.lon2 }
      const km = haversineKm(a, b, radiusKm)
      const factor = UNIT_FACTORS[unit] ?? 1
      const initial = initialBearing(a, b)
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
      }
    },
  })

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
      render: (_args: { lat1: number; lon1: number; lat2: number; lon2: number }, value: unknown) =>
        [{ type: 'text', text: renderBearing(value) }],
    },
    async execute(args: { lat1: number; lon1: number; lat2: number; lon2: number }): Promise<BearingResult> {
      const reason = validatePoint(args.lat1, args.lon1) ?? validatePoint(args.lat2, args.lon2)
      if (reason !== undefined) return { valid: false, reason }
      const a = { lat: args.lat1, lon: args.lon1 }
      const b = { lat: args.lat2, lon: args.lon2 }
      const initial = initialBearing(a, b)
      const midpoint = midpointOf(a, b)
      return {
        valid: true,
        initialBearing: round(initial),
        finalBearing: round(finalBearing(a, b)),
        compass: compassPoint(initial),
        midpointLat: round(midpoint.lat),
        midpointLon: round(midpoint.lon),
      }
    },
  })

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
      render: (_args: { lat: number; lon: number; bearing: number; distance: number; unit?: string }, value: unknown) =>
        [{ type: 'text', text: renderDestination(value) }],
    },
    async execute(args: { lat: number; lon: number; bearing: number; distance: number; unit?: string }): Promise<DestinationResult> {
      const pointReason = validatePoint(args.lat, args.lon)
      if (pointReason !== undefined) return { valid: false, reason: pointReason }
      if (!Number.isFinite(args.bearing) || args.bearing < 0 || args.bearing >= 360) {
        return { valid: false, reason: `bearing ${args.bearing} is out of range [0, 360)` }
      }
      const unit = args.unit ?? 'km'
      if (UNIT_FACTORS[unit] === undefined) {
        return { valid: false, reason: `unsupported unit "${unit}" (expected km, m, mi or nmi)` }
      }
      const factor = UNIT_FACTORS[unit] ?? 1
      const km = args.distance / factor
      if (!Number.isFinite(km) || km < 0) {
        return { valid: false, reason: `distance must be a non-negative number` }
      }
      if (km > maxDistanceKm) {
        return { valid: false, reason: `distance ${round(km, 2)} km exceeds half the sphere circumference (${round(maxDistanceKm, 2)} km)` }
      }
      const start = { lat: args.lat, lon: args.lon }
      const dest = destinationPoint(start, args.bearing, km, radiusKm)
      return {
        valid: true,
        lat: round(dest.lat),
        lon: round(dest.lon),
        latDms: formatDms(dest.lat, true),
        lonDms: formatDms(dest.lon, false),
        checkDistanceKm: round(haversineKm(start, dest, radiusKm)),
      }
    },
  })

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
      render: (_args: { value: string; kind?: string }, value: unknown) =>
        [{ type: 'text', text: renderCoord(value) }],
    },
    async execute(args: { value: string; kind?: string }): Promise<CoordParseResult> {
      const kind = (args.kind ?? 'auto') as CoordKind
      if (kind !== 'auto' && kind !== 'lat' && kind !== 'lon') {
        return { valid: false, input: args.value, error: `unsupported kind "${kind}" (expected auto, lat or lon)` }
      }
      const parsed = parseCoordInput(args.value, kind)
      if ('error' in parsed) {
        return { valid: false, input: args.value, error: parsed.error }
      }
      if ('value' in parsed) {
        const isLat = parsed.isLat
        const result: CoordParseResult = { valid: true, input: args.value }
        if (isLat) {
          result.latitude = round(parsed.value)
          result.latDms = formatDms(parsed.value, true)
        } else {
          result.longitude = round(parsed.value)
          result.lonDms = formatDms(parsed.value, false)
        }
        return result
      }
      const pair = parsed
      return {
        valid: true,
        input: args.value,
        latitude: round(pair.latitude),
        longitude: round(pair.longitude),
        latDms: formatDms(pair.latitude, true),
        lonDms: formatDms(pair.longitude, false),
      }
    },
  })

  return { geo_distance, geo_bearing, geo_destination, coord_parse }
}
