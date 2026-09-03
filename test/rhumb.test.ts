/**
 * Rhumb-line math tests. Every numeric anchor comes from the independent
 * closed-form + numeric-integration oracle test/anchors_v2.py — none of the
 * values were derived from the implementation itself.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_RADIUS_KM, compassPoint } from '../src/geodesy.ts'
import { rhumbBearing, rhumbDistanceKm } from '../src/rhumb.ts'
import { buildGeodesyTools } from '../src/tools.ts'

function assertNoUndefined(value: unknown, path = 'root'): void {
  if (value === undefined) throw new Error(`undefined value at ${path}`)
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    assertNoUndefined(child, `${path}.${key}`)
  }
}

const tools = buildGeodesyTools({ radiusKm: DEFAULT_RADIUS_KM })

describe('rhumbDistanceKm', () => {
  it('quarter equator: constant heading equals the great circle (exact)', () => {
    expect(rhumbDistanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 90 })).toBeCloseTo(10007.557221, 6)
  })

  it('45th parallel quarter: rhumb is longer than the great circle', () => {
    expect(rhumbDistanceKm({ lat: 45, lon: 0 }, { lat: 45, lon: 90 })).toBeCloseTo(7076.411574, 6)
  })

  it('general case (10,10) → (20,30)', () => {
    expect(rhumbDistanceKm({ lat: 10, lon: 10 }, { lat: 20, lon: 30 })).toBeCloseTo(2416.086291, 6)
  })

  it('southward case (10,0) → (-10,30)', () => {
    expect(rhumbDistanceKm({ lat: 10, lon: 0 }, { lat: -10, lon: 30 })).toBeCloseTo(3995.079153, 6)
  })

  it('is symmetric', () => {
    const a = { lat: 12.5, lon: -77.2 }
    const b = { lat: 40.7, lon: 12.3 }
    expect(rhumbDistanceKm(a, b)).toBeCloseTo(rhumbDistanceKm(b, a), 9)
  })

  it('returns 0 for identical points', () => {
    expect(rhumbDistanceKm({ lat: 12.5, lon: -77.2 }, { lat: 12.5, lon: -77.2 })).toBe(0)
  })
})

describe('rhumbBearing', () => {
  it('is 90° along the equator', () => {
    expect(rhumbBearing({ lat: 0, lon: 0 }, { lat: 0, lon: 90 })).toBeCloseTo(90, 6)
  })

  it('is 90° along a parallel', () => {
    expect(rhumbBearing({ lat: 45, lon: 0 }, { lat: 45, lon: 90 })).toBeCloseTo(90, 6)
  })

  it('general case (10,10) → (20,30)', () => {
    expect(rhumbBearing({ lat: 10, lon: 10 }, { lat: 20, lon: 30 })).toBeCloseTo(62.598173, 6)
  })

  it('southward case (10,0) → (-10,30) lands between 90 and 180', () => {
    expect(rhumbBearing({ lat: 10, lon: 0 }, { lat: -10, lon: 30 })).toBeCloseTo(123.825142, 6)
  })

  it('returns 0 for identical points', () => {
    expect(rhumbBearing({ lat: 12.5, lon: -77.2 }, { lat: 12.5, lon: -77.2 })).toBe(0)
  })
})

describe('geo_rhumb tool', () => {
  const execute = tools.geo_rhumb.execute as (args: {
    lat1: number; lon1: number; lat2: number; lon2: number; unit?: string
  }) => Promise<Record<string, unknown>>

  it('returns the anchored distance, bearing, compass and great-circle comparison', async () => {
    const result = await execute({ lat1: 10, lon1: 10, lat2: 20, lon2: 30 })
    assertNoUndefined(result)
    expect(result.valid).toBe(true)
    expect(result.distance).toBeCloseTo(2416.086291, 5)
    expect(result.bearing).toBeCloseTo(62.598173, 5)
    expect(result.compass).toBe(compassPoint(62.598173))
    expect(result.greatCircleKm).toBeCloseTo(2415.245707, 5)
  })

  it('converts to nautical miles', async () => {
    const result = await execute({ lat1: 0, lon1: 0, lat2: 0, lon2: 90, unit: 'nmi' })
    assertNoUndefined(result)
    expect(result.valid).toBe(true)
    expect(result.distance).toBeCloseTo(10007.557221 / 1.852, 5)
  })

  it('notes the degenerate zero-distance case', async () => {
    const result = await execute({ lat1: 12.5, lon1: -77.2, lat2: 12.5, lon2: -77.2 })
    assertNoUndefined(result)
    expect(result.valid).toBe(true)
    expect(result.bearing).toBe(0)
    expect(typeof result.note).toBe('string')
  })

  it('rejects invalid latitude', async () => {
    const result = await execute({ lat1: 91, lon1: 0, lat2: 0, lon2: 0 })
    expect(result.valid).toBe(false)
    expect(typeof result.reason).toBe('string')
  })

  it('rejects unsupported units at the schema layer (enum validation)', async () => {
    await expect(execute({ lat1: 0, lon1: 0, lat2: 1, lon2: 1, unit: 'yards' })).rejects.toThrow()
  })
})
