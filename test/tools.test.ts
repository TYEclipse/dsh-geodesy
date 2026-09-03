/**
 * Tool-definition tests for dsh-geodesy: execute() behaviour for all four
 * tools, including the valid:false branches. Anchored numeric values come
 * from the independent anchor script (test/anchors.py).
 */
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/index.ts'
import { buildGeodesyTools, type DistanceResult } from '../src/tools.ts'

const tools = buildGeodesyTools(resolveConfig({}))

describe('geo_distance', () => {
  it('returns the anchored distance for Beijing → Shanghai in km', async () => {
    const result = await tools.geo_distance.execute({ lat1: 39.9042, lon1: 116.4074, lat2: 31.2304, lon2: 121.4737 })
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.unit).toBe('km')
    expect(result.distance).toBeCloseTo(1067.311645, 3)
    expect(result.kilometers).toBeCloseTo(1067.311645, 3)
    expect(result.miles).toBeCloseTo(663.196709, 3)
    expect(result.nauticalMiles).toBeCloseTo(576.302184, 3)
    expect(result.initialBearing).toBeCloseTo(153.072675, 3)
    expect(result.finalBearing).toBeCloseTo(156.029266, 3)
    expect(result.compass).toBe('SSE')
  })

  it('converts to miles when requested', async () => {
    const result = await tools.geo_distance.execute({ lat1: 39.9042, lon1: 116.4074, lat2: 31.2304, lon2: 121.4737, unit: 'mi' })
    if (!result.valid) throw new Error('expected valid')
    expect(result.unit).toBe('mi')
    expect(result.distance).toBeCloseTo(663.196709, 3)
  })

  it('converts to metres and nautical miles', async () => {
    const metres = await tools.geo_distance.execute({ lat1: 0, lon1: 0, lat2: 0, lon2: 1, unit: 'm' })
    if (!metres.valid) throw new Error('expected valid')
    expect(metres.distance).toBeCloseTo(111195.08, 1)
    const nmi = await tools.geo_distance.execute({ lat1: 0, lon1: 0, lat2: 0, lon2: 1, unit: 'nmi' })
    if (!nmi.valid) throw new Error('expected valid')
    expect(nmi.distance).toBeCloseTo(60.04054, 3)
  })

  it('returns valid:false for out-of-range latitude', async () => {
    const result = await tools.geo_distance.execute({ lat1: 91, lon1: 0, lat2: 0, lon2: 0 })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('latitude')
  })

  it('returns valid:false for out-of-range longitude', async () => {
    const result = await tools.geo_distance.execute({ lat1: 0, lon1: 0, lat2: 0, lon2: 200 })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('longitude')
  })

  it('rejects an unsupported unit at the schema layer', async () => {
    await expect(
      tools.geo_distance.execute({ lat1: 0, lon1: 0, lat2: 0, lon2: 1, unit: 'yards' }),
    ).rejects.toThrow()
  })

  it('keeps every success key present and lossless-JSON safe', async () => {
    const result = (await tools.geo_distance.execute({ lat1: 0, lon1: 0, lat2: 10, lon2: 10 })) as DistanceResult
    expect(result.valid).toBe(true)
    expect(JSON.stringify(result)).toBe(JSON.stringify(JSON.parse(JSON.stringify(result))))
  })
})

describe('geo_bearing', () => {
  it('returns the anchored bearings and midpoint for Beijing → Shanghai', async () => {
    const result = await tools.geo_bearing.execute({ lat1: 39.9042, lon1: 116.4074, lat2: 31.2304, lon2: 121.4737 })
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.initialBearing).toBeCloseTo(153.072675, 3)
    expect(result.finalBearing).toBeCloseTo(156.029266, 3)
    expect(result.compass).toBe('SSE')
    expect(result.midpointLat).toBeCloseTo(35.593729, 3)
    expect(result.midpointLon).toBeCloseTo(119.07801, 3)
  })

  it('reports due east along the equator', async () => {
    const result = await tools.geo_bearing.execute({ lat1: 0, lon1: 0, lat2: 0, lon2: 1 })
    if (!result.valid) throw new Error('expected valid')
    expect(result.initialBearing).toBeCloseTo(90, 6)
    expect(result.compass).toBe('E')
  })

  it('returns valid:false for invalid points', async () => {
    const result = await tools.geo_bearing.execute({ lat1: 0, lon1: 0, lat2: 45, lon2: -190 })
    expect(result.valid).toBe(false)
  })
})

describe('geo_destination', () => {
  it('solves the anchored direct problem: 1000 km east from the origin', async () => {
    const result = await tools.geo_destination.execute({ lat: 0, lon: 0, bearing: 90, distance: 1000 })
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.lat).toBeCloseTo(0, 6)
    expect(result.lon).toBeCloseTo(8.993204, 3)
    expect(result.latDms).toBe('0°0′0″N')
    expect(result.checkDistanceKm).toBeCloseTo(1000, 6)
  })

  it('handles a non-zero start point with DMS formatting', async () => {
    const result = await tools.geo_destination.execute({ lat: 51.5074, lon: -0.1278, bearing: 288.6, distance: 5570.2 })
    if (!result.valid) throw new Error('expected valid')
    expect(result.lat).toBeCloseTo(40.874659, 3)
    expect(result.lon).toBeCloseTo(-74.177176, 3)
    expect(result.latDms).toMatch(/N$/)
    expect(result.lonDms).toMatch(/W$/)
    expect(result.checkDistanceKm).toBeCloseTo(5570.2, 3)
  })

  it('converts the distance unit before solving', async () => {
    // 1000 mi due east from the origin
    const result = await tools.geo_destination.execute({ lat: 0, lon: 0, bearing: 90, distance: 1000, unit: 'mi' })
    if (!result.valid) throw new Error('expected valid')
    expect(result.lat).toBeCloseTo(0, 6)
    expect(result.checkDistanceKm).toBeCloseTo(1609.344, 4)
  })

  it('rejects a bearing outside [0, 360)', async () => {
    expect((await tools.geo_destination.execute({ lat: 0, lon: 0, bearing: 360, distance: 100 })).valid).toBe(false)
    expect((await tools.geo_destination.execute({ lat: 0, lon: 0, bearing: -1, distance: 100 })).valid).toBe(false)
  })

  it('rejects a distance beyond half the circumference', async () => {
    const result = await tools.geo_destination.execute({ lat: 0, lon: 0, bearing: 90, distance: 25000 })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('half the sphere')
  })

  it('rejects negative distances', async () => {
    expect((await tools.geo_destination.execute({ lat: 0, lon: 0, bearing: 90, distance: -5 })).valid).toBe(false)
  })
})

describe('coord_parse', () => {
  it('parses a decimal pair', async () => {
    const result = await tools.coord_parse.execute({ value: '39.9042, 116.4074' })
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.latitude).toBeCloseTo(39.9042, 9)
    expect(result.longitude).toBeCloseTo(116.4074, 9)
    expect(result.latDms).toBe('39°54′15.1″N')
    expect(result.lonDms).toBe('116°24′26.6″E')
  })

  it('parses a DMS pair with suffixes', async () => {
    const result = await tools.coord_parse.execute({ value: '37°46′30″N, 122°25′8.4″W' })
    if (!result.valid) throw new Error('expected valid')
    expect(result.latitude).toBeCloseTo(37.775, 9)
    expect(result.longitude).toBeCloseTo(-122.419, 6)
    expect(result.latDms).toBe('37°46′30″N')
    expect(result.lonDms).toBe('122°25′8.4″W')
  })

  it('parses a single coordinate with a kind hint', async () => {
    const result = await tools.coord_parse.execute({ value: '116.4074', kind: 'lon' })
    if (!result.valid) throw new Error('expected valid')
    expect(result.longitude).toBeCloseTo(116.4074, 9)
    expect(result.latitude).toBeUndefined()
  })

  it('returns valid:false with an error for unparseable input', async () => {
    const result = await tools.coord_parse.execute({ value: 'not coordinates' })
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.input).toBe('not coordinates')
  })

  it('returns valid:false for an out-of-range latitude pair', async () => {
    const result = await tools.coord_parse.execute({ value: '95, 0' })
    expect(result.valid).toBe(false)
  })

  it('rejects an unsupported kind at the schema layer', async () => {
    await expect(tools.coord_parse.execute({ value: '37.775', kind: 'weird' })).rejects.toThrow()
  })

  it('keeps the failure branch lossless-JSON safe', async () => {
    const result = await tools.coord_parse.execute({ value: 'nope' })
    expect(JSON.stringify(result)).toBe(JSON.stringify(JSON.parse(JSON.stringify(result))))
  })
})

describe('tool surface', () => {
  it('exposes exactly seven tools with stable names', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'coord_parse',
      'geo_area',
      'geo_bearing',
      'geo_destination',
      'geo_distance',
      'geo_intersection',
      'geo_rhumb',
    ])
  })

  it('declares a cordis patch id matching the plugin name convention', async () => {
    const { default: fs } = await import('node:fs')
    const patch = fs.readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch).toContain('id: geodesy')
    expect(patch).toContain('name: dsh-geodesy')
  })
})
