/**
 * Great-circle intersection tests. Anchors from the independent vector
 * oracle test/anchors_v2.py; every result is additionally cross-checked
 * against the geometric property that the crossing must lie on both
 * circles (bearing from each start equals the path bearing).
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_RADIUS_KM, initialBearing } from '../src/geodesy.ts'
import { greatCircleIntersection } from '../src/intersection.ts'
import { buildGeodesyTools } from '../src/tools.ts'

function assertNoUndefined(value: unknown, path = 'root'): void {
  if (value === undefined) throw new Error(`undefined value at ${path}`)
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    assertNoUndefined(child, `${path}.${key}`)
  }
}

/** Bearing difference normalized to [0, 180]. */
function bearingDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

const tools = buildGeodesyTools({ radiusKm: DEFAULT_RADIUS_KM })

describe('greatCircleIntersection', () => {
  it('equator x meridian: crosses exactly at the meridian start (0, 90)', () => {
    const out = greatCircleIntersection({ lat: 0, lon: 0 }, 90, { lat: 0, lon: 90 }, 0)
    expect(out.error).toBeUndefined()
    const r = out.result!
    expect(r.point.lat).toBeCloseTo(0, 6)
    expect(r.point.lon).toBeCloseTo(90, 6)
    expect(r.point.distanceFromStart1Km).toBeCloseTo(10007.557221, 5)
    expect(r.point.distanceFromStart2Km).toBeCloseTo(0, 5)
    expect(r.antipode.lat).toBeCloseTo(0, 6)
    expect(r.antipode.lon).toBeCloseTo(-90, 6)
  })

  it('two meridians meet at the north pole (90, 0)', () => {
    const out = greatCircleIntersection({ lat: 0, lon: 0 }, 0, { lat: 0, lon: 90 }, 0)
    expect(out.error).toBeUndefined()
    const r = out.result!
    expect(r.point.lat).toBeCloseTo(90, 6)
    expect(r.point.lon).toBeCloseTo(0, 6)
    expect(r.point.distanceFromStart1Km).toBeCloseTo(10007.557221, 5)
    expect(r.point.distanceFromStart2Km).toBeCloseTo(10007.557221, 5)
    expect(r.antipode.lat).toBeCloseTo(-90, 6)
  })

  it('same start, different bearings: crossing is the common point itself', () => {
    const out = greatCircleIntersection({ lat: 30, lon: 60 }, 45, { lat: 30, lon: 60 }, 150)
    expect(out.error).toBeUndefined()
    const r = out.result!
    expect(r.point.lat).toBeCloseTo(30, 6)
    expect(r.point.lon).toBeCloseTo(60, 6)
    expect(r.point.distanceFromStart1Km).toBeCloseTo(0, 5)
    expect(r.point.distanceFromStart2Km).toBeCloseTo(0, 5)
    expect(r.antipode.lat).toBeCloseTo(-30, 6)
    expect(r.antipode.lon).toBeCloseTo(-120, 6)
  })

  it('coincident paths (equator both ways) are rejected', () => {
    const out = greatCircleIntersection({ lat: 0, lon: 0 }, 90, { lat: 0, lon: 40 }, 90)
    expect(out.error).toContain('coincident')
    const rev = greatCircleIntersection({ lat: 0, lon: 0 }, 90, { lat: 0, lon: 40 }, 270)
    expect(rev.error).toContain('coincident')
  })

  it('general case (10,30) brng 60 x (20,40) brng 200: anchored point on both circles', () => {
    const out = greatCircleIntersection({ lat: 10, lon: 30 }, 60, { lat: 20, lon: 40 }, 200)
    expect(out.error).toBeUndefined()
    const r = out.result!
    expect(r.point.lat).toBeCloseTo(14.300938, 5)
    expect(r.point.lon).toBeCloseTo(37.867353, 5)
    expect(r.point.distanceFromStart1Km).toBeCloseTo(979.624589, 5)
    expect(r.point.distanceFromStart2Km).toBeCloseTo(672.960503, 5)
    expect(bearingDiff(initialBearing({ lat: 10, lon: 30 }, r.point), 60)).toBeLessThan(0.001)
    expect(bearingDiff(initialBearing({ lat: 20, lon: 40 }, r.point), 200)).toBeLessThan(0.001)
  })

  it('general case (50,0) brng 60 x (30,45) brng 300: nearest crossing is behind path 1', () => {
    const out = greatCircleIntersection({ lat: 50, lon: 0 }, 60, { lat: 30, lon: 45 }, 300)
    expect(out.error).toBeUndefined()
    const r = out.result!
    expect(r.point.lat).toBeCloseTo(40.569082, 5)
    expect(r.point.lon).toBeCloseTo(-17.985875, 5)
    expect(r.point.distanceFromStart1Km).toBeCloseTo(1747.377106, 5)
    expect(r.point.distanceFromStart2Km).toBeCloseTo(5714.564741, 5)
    expect(bearingDiff(initialBearing({ lat: 50, lon: 0 }, r.point), 240)).toBeLessThan(0.001)
    expect(bearingDiff(initialBearing({ lat: 30, lon: 45 }, r.point), 300)).toBeLessThan(0.001)
    expect(r.behindStart1).toBe(true)
    expect(r.antipode.lat).toBeCloseTo(-40.569082, 5)
    expect(r.antipode.lon).toBeCloseTo(162.014125, 5)
  })

  it('rejects a path starting at a pole', () => {
    const out = greatCircleIntersection({ lat: 90, lon: 0 }, 0, { lat: 0, lon: 0 }, 90)
    expect(out.error).toContain('pole')
  })
})

describe('geo_intersection tool', () => {
  const execute = tools.geo_intersection.execute as (args: {
    lat1: number; lon1: number; bearing1: number; lat2: number; lon2: number; bearing2: number
  }) => Promise<Record<string, unknown>>

  it('reports the anchored crossing with antipode and note', async () => {
    const result = await execute({ lat1: 50, lon1: 0, bearing1: 60, lat2: 30, lon2: 45, bearing2: 300 })
    assertNoUndefined(result)
    expect(result.valid).toBe(true)
    expect(result.lat).toBeCloseTo(40.569082, 5)
    expect(result.lon).toBeCloseTo(-17.985875, 5)
    expect(result.antipodeLat).toBeCloseTo(-40.569082, 5)
    expect(result.antipodeLon).toBeCloseTo(162.014125, 5)
    expect(typeof result.note).toBe('string')
  })

  it('rejects out-of-range bearings', async () => {
    const result = await execute({ lat1: 0, lon1: 0, bearing1: 360, lat2: 10, lon2: 10, bearing2: 45 })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('bearing1')
  })

  it('reports coincident paths as invalid', async () => {
    const result = await execute({ lat1: 0, lon1: 0, bearing1: 90, lat2: 0, lon2: 40, bearing2: 90 })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('coincident')
  })
})
