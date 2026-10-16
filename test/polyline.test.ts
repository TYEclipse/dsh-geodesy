/**
 * geo_path (multi-leg route totals) — v0.4.0.
 *
 * Every numeric expectation below is printed by the committed oracle; run
 * `python3 test/oracle/anchors.py` (section D, "multi-leg route totals") to
 * see them. The oracle computes the legs with the closed-form haversine and
 * asserts the route invariants (total = sum of legs, total ≥ straight line,
 * detour ≥ 0, closure = distance back to the start) in `--check`.
 *
 * ORACLE: test/oracle/anchors.py
 */
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/index.ts'
import { buildGeodesyTools, type PathToolResult } from '../src/tools.ts'
import { assertLossless } from './helpers/lossless-json.ts'

const tools = buildGeodesyTools(resolveConfig({}))

const ROUTE1 = [
  { lat: 0, lon: 0 },
  { lat: 0, lon: 10 },
  { lat: 10, lon: 10 },
  { lat: 10, lon: 20 },
]

const BEIJING = { lat: 39.9042, lon: 116.4074 }
const SHANGHAI = { lat: 31.2304, lon: 121.4737 }
const HONGKONG = { lat: 22.3193, lon: 114.1694 }
const LONDON = { lat: 51.5074, lon: -0.1278 }
const PARIS = { lat: 48.8566, lon: 2.3522 }
const ROME = { lat: 41.9028, lon: 12.4964 }

describe('geo_path totals', () => {
  it('totals the anchored three-leg route and reports its detour', async () => {
    const result = await tools.geo_path.execute({ points: ROUTE1 })
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.points).toBe(4)
    expect(result.totalKm).toBeCloseTo(3318.917342, 4)
    expect(result.straightKm).toBeCloseTo(2476.174831, 4)
    expect(result.detourKm).toBeCloseTo(842.742511, 4)
    expect(result.detourPercent).toBeCloseTo(34.034, 3)
    expect(result.closureKm).toBeCloseTo(2476.174831, 4)
    expect(result.closesLoop).toBe(false)
    expect(result.maxLegKm).toBeCloseTo(1111.950802, 4)
    expect(result.minLegKm).toBeCloseTo(1095.015737, 4)
    expect(result.zeroLengthLegs).toEqual([])
    expect(result.note).toBeUndefined()
  })

  it('reports every leg with its cumulative total, heading and compass point', async () => {
    const result = await tools.geo_path.execute({ points: ROUTE1 })
    if (!result.valid) throw new Error('expected valid')
    expect(result.legs).toHaveLength(3)
    const [leg1, leg2, leg3] = result.legs!
    expect(leg1).toMatchObject({ leg: 1, fromIndex: 0, toIndex: 1, compass: 'E' })
    expect(leg1!.distanceKm).toBeCloseTo(1111.950802, 4)
    expect(leg1!.cumulativeKm).toBeCloseTo(1111.950802, 4)
    expect(leg1!.initialBearing).toBeCloseTo(90, 6)
    expect(leg2!.distanceKm).toBeCloseTo(1111.950802, 4)
    expect(leg2!.cumulativeKm).toBeCloseTo(2223.901605, 4)
    expect(leg2!.initialBearing).toBeCloseTo(0, 6)
    expect(leg2!.compass).toBe('N')
    expect(leg3!.distanceKm).toBeCloseTo(1095.015737, 4)
    expect(leg3!.cumulativeKm).toBeCloseTo(3318.917342, 4)
    expect(leg3!.initialBearing).toBeCloseTo(89.129615, 4)
    expect(leg3!.compass).toBe('E')
  })

  it('agrees with the oracle on the Beijing → Shanghai → Hong Kong route', async () => {
    const result = await tools.geo_path.execute({ points: [BEIJING, SHANGHAI, HONGKONG] })
    if (!result.valid) throw new Error('expected valid')
    expect(result.points).toBe(3)
    expect(result.totalKm).toBeCloseTo(2294.343754, 4)
    expect(result.straightKm).toBeCloseTo(1966.736942, 4)
    expect(result.detourKm).toBeCloseTo(327.606812, 4)
    expect(result.detourPercent).toBeCloseTo(16.657, 3)
    expect(result.legs![0]!.distanceKm).toBeCloseTo(1067.311645, 4)
    expect(result.legs![0]!.initialBearing).toBeCloseTo(153.072675, 4)
    expect(result.legs![0]!.compass).toBe('SSE')
    expect(result.legs![1]!.distanceKm).toBeCloseTo(1227.032109, 4)
    expect(result.legs![1]!.initialBearing).toBeCloseTo(217.913311, 4)
    expect(result.legs![1]!.compass).toBe('SW')
  })

  it('totals a zig-zag route whose legs turn', async () => {
    const result = await tools.geo_path.execute({
      points: [{ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, { lat: 5, lon: 20 }, { lat: 0, lon: 30 }],
    })
    if (!result.valid) throw new Error('expected valid')
    expect(result.totalKm).toBeCloseTo(3595.816011, 4)
    expect(result.straightKm).toBeCloseTo(3335.852407, 4)
    expect(result.detourKm).toBeCloseTo(259.963604, 4)
    expect(result.detourPercent).toBeCloseTo(7.793, 3)
    expect(result.legs![1]!.initialBearing).toBeCloseTo(63.259795, 4)
    expect(result.legs![1]!.compass).toBe('ENE')
    expect(result.legs![2]!.initialBearing).toBeCloseTo(116.302486, 4)
    expect(result.legs![2]!.compass).toBe('ESE')
  })

  it('reports the small detour of the London → Paris → Rome route', async () => {
    const result = await tools.geo_path.execute({ points: [LONDON, PARIS, ROME] })
    if (!result.valid) throw new Error('expected valid')
    expect(result.totalKm).toBeCloseTo(1448.83821, 4)
    expect(result.straightKm).toBeCloseTo(1433.783288, 4)
    expect(result.detourKm).toBeCloseTo(15.054922, 6)
    expect(result.detourPercent).toBeCloseTo(1.05, 3)
    expect(result.minLegKm).toBeCloseTo(343.556535, 4)
  })

  it('derives the detour from the two reported totals so a reader can check it', async () => {
    const result = await tools.geo_path.execute({ points: ROUTE1 })
    if (!result.valid) throw new Error('expected valid')
    const recomputed = Number((result.totalKm! - result.straightKm!).toFixed(6))
    expect(result.detourKm).toBeCloseTo(recomputed, 6)
  })
})

describe('geo_path edge cases', () => {
  it('reports a zero-length leg with no heading instead of inventing 0°', async () => {
    const result = await tools.geo_path.execute({
      points: [{ lat: 0, lon: 0 }, { lat: 0, lon: 0 }, { lat: 0, lon: 10 }],
    })
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.zeroLengthLegs).toEqual([1])
    expect(result.legs![0]!.distanceKm).toBe(0)
    expect(result.legs![0]!.initialBearing).toBeUndefined()
    expect(result.legs![0]!.compass).toBeUndefined()
    expect(result.legs![1]!.initialBearing).toBeCloseTo(90, 6)
    expect(result.totalKm).toBeCloseTo(1111.950802, 4)
    expect(result.detourKm).toBeCloseTo(0, 6)
    expect(result.note).toContain('zero-length')
  })

  it('flags a closed loop and withholds a meaningless detour percentage', async () => {
    const result = await tools.geo_path.execute({
      points: [{ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, { lat: 0, lon: 20 }, { lat: 0, lon: 0 }],
    })
    if (!result.valid) throw new Error('expected valid')
    expect(result.closesLoop).toBe(true)
    expect(result.straightKm).toBe(0)
    expect(result.closureKm).toBe(0)
    expect(result.detourPercent).toBeUndefined()
    expect(result.totalKm).toBeCloseTo(4447.803209, 4)
    expect(result.note).toContain('closed loop')
  })

  it('handles a route whose two waypoints are identical', async () => {
    const result = await tools.geo_path.execute({
      points: [{ lat: 10, lon: 10 }, { lat: 10, lon: 10 }],
    })
    if (!result.valid) throw new Error('expected valid')
    expect(result.totalKm).toBe(0)
    expect(result.straightKm).toBe(0)
    expect(result.detourKm).toBe(0)
    expect(result.zeroLengthLegs).toEqual([1])
    expect(result.closesLoop).toBe(true)
  })

  it('reports zero detour for an antipodal two-point path', async () => {
    const result = await tools.geo_path.execute({
      points: [{ lat: 0, lon: 0 }, { lat: 0, lon: 180 }],
    })
    if (!result.valid) throw new Error('expected valid')
    expect(result.totalKm).toBeCloseTo(20015.114442, 4)
    expect(result.straightKm).toBeCloseTo(20015.114442, 4)
    expect(result.detourKm).toBeCloseTo(0, 6)
    expect(result.detourPercent).toBeCloseTo(0, 6)
  })

  it('rejects a single waypoint', async () => {
    const result = await tools.geo_path.execute({ points: [{ lat: 0, lon: 0 }] })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('at least 2')
  })

  it('rejects more waypoints than the documented limit', async () => {
    const points = Array.from({ length: 51 }, (_, i) => ({ lat: 0, lon: i * 0.001 }))
    const result = await tools.geo_path.execute({ points })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('at most 50')
  })

  it('names the offending waypoint when a coordinate is out of range', async () => {
    const result = await tools.geo_path.execute({
      points: [{ lat: 0, lon: 0 }, { lat: 95, lon: 0 }, { lat: 0, lon: 10 }],
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('waypoint 2')
  })

  it('rejects a non-array points argument at the schema layer', async () => {
    await expect(
      tools.geo_path.execute({ points: 'nope' as unknown as Array<{ lat: number; lon: number }> }),
    ).rejects.toThrow()
  })

  it('keeps success and failure results lossless-JSON safe', async () => {
    const ok = await tools.geo_path.execute({ points: ROUTE1 })
    assertLossless(ok)
    const dup = await tools.geo_path.execute({ points: [{ lat: 1, lon: 1 }, { lat: 1, lon: 1 }] })
    assertLossless(dup)
    const bad = await tools.geo_path.execute({ points: [{ lat: 0, lon: 0 }] })
    assertLossless(bad)
  })

  it('renders a human-readable summary', async () => {
    const result = await tools.geo_path.execute({ points: ROUTE1 }) as PathToolResult
    const rendered = tools.geo_path.output!.render!({ points: ROUTE1 }, result)[0]!.text as string
    expect(rendered).toContain('4-waypoint path')
    expect(rendered).toContain('3318.917342 km')
    expect(rendered).toContain('detour +842.742511 km')
  })

  it('reports an invalid-input line when the path is rejected', async () => {
    const rendered = tools.geo_path.output!.render!(
      { points: [] },
      { valid: false, reason: 'a path needs at least 2 waypoints (got 1)' } as PathToolResult,
    )[0]!.text as string
    expect(rendered).toContain('invalid input')
    expect(rendered).toContain('at least 2 waypoints')
  })
})
