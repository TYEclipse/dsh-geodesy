/**
 * Spherical polygon area tests. Anchors from the independent vector oracle
 * test/anchors_v2.py: the octant triangle is exact (E = pi/2), and small
 * polygons are cross-checked against the planar shoelace limit.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_RADIUS_KM } from '../src/geodesy.ts'
import { MAX_VERTICES, sphericalPolygonArea } from '../src/area.ts'
import { buildGeodesyTools } from '../src/tools.ts'

function assertNoUndefined(value: unknown, path = 'root'): void {
  if (value === undefined) throw new Error(`undefined value at ${path}`)
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    assertNoUndefined(child, `${path}.${key}`)
  }
}

const OCTANT_CCW = [{ lat: 0, lon: 0 }, { lat: 0, lon: 90 }, { lat: 90, lon: 0 }]
const OCTANT_CW = [{ lat: 0, lon: 0 }, { lat: 90, lon: 0 }, { lat: 0, lon: 90 }]
const SMALL_SQUARE_CW = [{ lat: 0, lon: 0 }, { lat: 0.1, lon: 0 }, { lat: 0.1, lon: 0.1 }, { lat: 0, lon: 0.1 }]
const PENTAGON_CW = [{ lat: 0, lon: 0 }, { lat: 2, lon: 0 }, { lat: 2, lon: 2 }, { lat: 1, lon: 1 }, { lat: 0, lon: 2 }]
const PENTAGON_CCW = [{ lat: 0, lon: 0 }, { lat: 0, lon: 2 }, { lat: 1, lon: 1 }, { lat: 2, lon: 2 }, { lat: 2, lon: 0 }]

const tools = buildGeodesyTools({ radiusKm: DEFAULT_RADIUS_KM })

describe('sphericalPolygonArea', () => {
  it('octant triangle (CCW): area is exactly pi/2 * R^2', () => {
    const out = sphericalPolygonArea(OCTANT_CCW)
    expect(out.error).toBeUndefined()
    const r = out.result!
    expect(r.areaKm2).toBeCloseTo(63758235.1216, 4)
    expect(r.perimeterKm).toBeCloseTo(30022.6717, 4)
    expect(r.excessRadians).toBeCloseTo(Math.PI / 2, 10)
    expect(r.complementKm2).toBeCloseTo(446307645.8513, 4)
  })

  it('octant triangle (CW): left region is the complement (exactly 7pi/2 * R^2)', () => {
    const out = sphericalPolygonArea(OCTANT_CW)
    expect(out.error).toBeUndefined()
    const r = out.result!
    expect(r.areaKm2).toBeCloseTo(446307645.8513, 4)
    expect(r.complementKm2).toBeCloseTo(63758235.1216, 4)
  })

  it('small CW square: complement matches the planar shoelace limit', () => {
    const out = sphericalPolygonArea(SMALL_SQUARE_CW)
    expect(out.error).toBeUndefined()
    const r = out.result!
    expect(r.perimeterKm).toBeCloseTo(44.478015, 5)
    expect(Math.abs(r.complementKm2 - 123.643412) / 123.643412).toBeLessThan(0.005)
  })

  it('reflex pentagon (CCW): area matches the planar limit, reflex vertex handled', () => {
    const out = sphericalPolygonArea(PENTAGON_CCW)
    expect(out.error).toBeUndefined()
    const r = out.result!
    expect(r.areaKm2).toBeCloseTo(37089.2656, 2)
    expect(Math.abs(r.areaKm2 - 37087.3882) / 37087.3882).toBeLessThan(0.001)
    expect(r.perimeterKm).toBeCloseTo(981.5102, 4)
  })

  it('reflex pentagon (CW): complement matches the planar limit', () => {
    const out = sphericalPolygonArea(PENTAGON_CW)
    expect(out.error).toBeUndefined()
    const r = out.result!
    expect(Math.abs(r.complementKm2 - 37087.3882) / 37087.3882).toBeLessThan(0.001)
  })

  it('rejects fewer than 3 vertices', () => {
    const out = sphericalPolygonArea([{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }])
    expect(out.error).toContain('at least 3')
  })

  it('rejects more than the vertex limit', () => {
    const many: Array<{ lat: number; lon: number }> = []
    for (let i = 0; i <= MAX_VERTICES; i += 1) many.push({ lat: i % 90, lon: i % 180 })
    const out = sphericalPolygonArea(many)
    expect(out.error).toContain('too many vertices')
  })

  it('rejects duplicate adjacent vertices', () => {
    const out = sphericalPolygonArea([
      { lat: 0, lon: 0 }, { lat: 1, lon: 0 }, { lat: 1, lon: 0 }, { lat: 0, lon: 1 },
    ])
    expect(out.error).toContain('identical or antipodal')
  })

  it('rejects antipodal adjacent vertices', () => {
    const out = sphericalPolygonArea([
      { lat: 0, lon: 0 }, { lat: 0, lon: 180 }, { lat: 10, lon: 10 },
    ])
    expect(out.error).toContain('identical or antipodal')
  })

  it('rejects out-of-range vertices', () => {
    const out = sphericalPolygonArea([
      { lat: 0, lon: 0 }, { lat: 91, lon: 0 }, { lat: 0, lon: 1 },
    ])
    expect(out.error).toContain('out of range')
  })
})

describe('geo_area tool', () => {
  const execute = tools.geo_area.execute as (args: {
    points: Array<{ lat: number; lon: number }>
  }) => Promise<Record<string, unknown>>

  it('returns anchored values for the CCW octant', async () => {
    const result = await execute({ points: OCTANT_CCW })
    assertNoUndefined(result)
    expect(result.valid).toBe(true)
    expect(result.vertices).toBe(3)
    expect(result.areaKm2).toBeCloseTo(63758235.1216, 4)
    expect(result.perimeterKm).toBeCloseTo(30022.6717, 4)
    expect(result.complementKm2).toBeCloseTo(446307645.8513, 4)
    expect(result.note).toBeUndefined()
  })

  it('notes when the left region exceeds a hemisphere (CW octant)', async () => {
    const result = await execute({ points: OCTANT_CW })
    assertNoUndefined(result)
    expect(result.valid).toBe(true)
    expect(result.areaKm2).toBeCloseTo(446307645.8513, 4)
    expect(typeof result.note).toBe('string')
  })

  it('rejects a 2-vertex input', async () => {
    const result = await execute({ points: [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }] })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('at least 3')
  })
})
