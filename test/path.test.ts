/**
 * Cross-track / along-track tests: the `geo_cross_track` tool surface and the
 * `src/path.ts` module behind it.
 *
 * ORACLE: test/oracle/anchors.py — every numeric expectation below is printed
 * by that script (its cases C1-C9). The oracle computes the same quantities
 * with the scalar Movable Type Scripts closed forms and builds the
 * perpendicular foot with the direct (destination) formula, while src/path.ts
 * works in 3D unit vectors — two independent routes to the same numbers.
 *
 * @module dsh-geodesy/test/path
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_RADIUS_KM } from '../src/geodesy.ts'
import { crossTrack } from '../src/path.ts'
import { buildGeodesyTools } from '../src/tools.ts'

const tools = buildGeodesyTools({ radiusKm: DEFAULT_RADIUS_KM })

/** rc.x ToolDefinition.execute is typed (args, exec); tests call it single-arg (R14). */
type Exec1<TArgs, TOut> = (args: TArgs) => Promise<TOut>

const execCross = tools.geo_cross_track.execute as unknown as Exec1<
  { lat1: number; lon1: number; lat2: number; lon2: number; lat3: number; lon3: number },
  {
    valid: boolean
    side?: string
    crossTrackKm?: number
    distanceToPathKm?: number
    alongTrackKm?: number
    footLat?: number
    footLon?: number
    withinSegment?: boolean
    distanceToSegmentKm?: number
    pathLengthKm?: number
    trackBearing?: number
    bearingToFoot?: number
    note?: string
    reason?: string
  }
>

function assertNoUndefined(value: unknown, path = 'root'): void {
  if (value === undefined) throw new Error(`undefined value at ${path}`)
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    assertNoUndefined(child, `${path}.${key}`)
  }
}

const EQUATOR_PATH = { lat1: 0, lon1: 0, lat2: 0, lon2: 10 }

describe('crossTrack', () => {
  it('reports a point north of the equator path as left of the track', () => {
    const out = crossTrack({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, { lat: 1, lon: 5 })
    expect(out.error).toBeUndefined()
    const info = out.result!
    expect(info.crossTrackKm).toBeCloseTo(111.19508, 3)
    expect(info.alongTrackKm).toBeCloseTo(555.975401, 3)
    expect(info.foot.lat).toBeCloseTo(0, 6)
    expect(info.foot.lon).toBeCloseTo(5, 3)
    expect(info.withinSegment).toBe(true)
    expect(info.distanceToSegmentKm).toBeCloseTo(111.19508, 3)
    expect(info.pathLengthKm).toBeCloseTo(1111.950802, 3)
  })

  it('flips the sign (and the foot bearing) for a point south of the path', () => {
    const out = crossTrack({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, { lat: -1, lon: 5 })
    const info = out.result!
    expect(info.crossTrackKm).toBeCloseTo(-111.19508, 3)
    expect(info.foot.lon).toBeCloseTo(5, 3)
    expect(info.withinSegment).toBe(true)
  })

  it('reports a negative along-track distance when the foot falls behind the start', () => {
    const out = crossTrack({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, { lat: 1, lon: -5 })
    const info = out.result!
    expect(info.alongTrackKm).toBeCloseTo(-555.975401, 3)
    expect(info.foot.lon).toBeCloseTo(-5, 3)
    expect(info.withinSegment).toBe(false)
    // outside the segment, the reported distance is to the nearer endpoint
    expect(info.distanceToSegmentKm).toBeCloseTo(566.95819, 3)
  })

  it('falls back to the endpoint distance when the foot is beyond the end', () => {
    const out = crossTrack({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, { lat: 1, lon: 25 })
    const info = out.result!
    expect(info.alongTrackKm).toBeCloseTo(2779.877006, 3)
    expect(info.withinSegment).toBe(false)
    expect(info.distanceToSegmentKm).toBeCloseTo(1671.543712, 3)
  })

  it('handles an oblique path (Beijing → Shanghai, query point offshore)', () => {
    const out = crossTrack(
      { lat: 39.9042, lon: 116.4074 },
      { lat: 31.2304, lon: 121.4737 },
      { lat: 30.0, lon: 120.0 },
    )
    const info = out.result!
    expect(info.pathLengthKm).toBeCloseTo(1067.311645, 3)
    expect(info.crossTrackKm).toBeCloseTo(-184.88092, 3)
    expect(info.alongTrackKm).toBeCloseTo(1133.832206, 3)
    expect(info.foot.lat).toBeCloseTo(30.683454, 3)
    expect(info.foot.lon).toBeCloseTo(121.756306, 3)
    expect(info.withinSegment).toBe(false)
    expect(info.distanceToSegmentKm).toBeCloseTo(196.480782, 3)
  })

  it('handles a meridian path (cross-track is not the longitude difference)', () => {
    const out = crossTrack({ lat: 0, lon: 0 }, { lat: 50, lon: 0 }, { lat: 20, lon: 10 })
    const info = out.result!
    expect(info.pathLengthKm).toBeCloseTo(5559.754012, 3)
    expect(info.crossTrackKm).toBeCloseTo(-1044.264778, 3)
    expect(info.alongTrackKm).toBeCloseTo(2255.432021, 3)
    expect(info.foot.lat).toBeCloseTo(20.283559, 3)
    expect(info.foot.lon).toBeCloseTo(0, 6)
    expect(info.withinSegment).toBe(true)
  })

  it('treats the path start itself as on-track with a zero distance', () => {
    const out = crossTrack({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, { lat: 0, lon: 0 })
    const info = out.result!
    expect(info.crossTrackKm).toBeCloseTo(0, 9)
    expect(info.alongTrackKm).toBeCloseTo(0, 9)
    expect(info.withinSegment).toBe(true)
    expect(info.distanceToSegmentKm).toBeCloseTo(0, 9)
  })

  it('scales with the configured sphere radius (moon-sized sphere)', () => {
    const out = crossTrack({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, { lat: 1, lon: 5 }, 1737.4)
    const info = out.result!
    expect(info.pathLengthKm).toBeCloseTo(303.233504, 3)
    expect(info.crossTrackKm).toBeCloseTo(30.32335, 3)
    expect(info.alongTrackKm).toBeCloseTo(151.616752, 3)
    expect(info.distanceToSegmentKm).toBeCloseTo(30.32335, 3)
  })

  it('rejects a point exactly 90 degrees off the path (no unique foot)', () => {
    const out = crossTrack({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, { lat: 90, lon: 0 })
    expect(out.result).toBeUndefined()
    expect(out.error).toContain('exactly 90 degrees off the path')
  })

  it('rejects coincident and antipodal path endpoints', () => {
    const same = crossTrack({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }, { lat: 1, lon: 1 })
    expect(same.error).toContain('coincide')
    const antipodal = crossTrack({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }, { lat: 1, lon: 1 })
    expect(antipodal.error).toContain('antipodal')
  })
})

describe('geo_cross_track', () => {
  it('returns the anchored off-track report for a point beside the equator path', async () => {
    const result = await execCross({ ...EQUATOR_PATH, lat3: 1, lon3: 5 })
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.side).toBe('left')
    expect(result.crossTrackKm).toBeCloseTo(111.19508, 3)
    expect(result.distanceToPathKm).toBeCloseTo(111.19508, 3)
    expect(result.alongTrackKm).toBeCloseTo(555.975401, 3)
    expect(result.footLat).toBeCloseTo(0, 6)
    expect(result.footLon).toBeCloseTo(5, 3)
    expect(result.withinSegment).toBe(true)
    expect(result.distanceToSegmentKm).toBeCloseTo(111.19508, 3)
    expect(result.pathLengthKm).toBeCloseTo(1111.950802, 3)
    expect(result.trackBearing).toBeCloseTo(90, 6)
    expect(result.bearingToFoot).toBeCloseTo(180, 6)
    expect(result.note).toBeUndefined()
    assertNoUndefined(result)
  })

  it('names the right-hand side and the rejoin bearing for a southern point', async () => {
    const result = await execCross({ ...EQUATOR_PATH, lat3: -1, lon3: 5 })
    expect(result.side).toBe('right')
    expect(result.crossTrackKm).toBeCloseTo(-111.19508, 3)
    expect(result.bearingToFoot).toBeCloseTo(0, 6)
    assertNoUndefined(result)
  })

  it('explains that the distance outside the segment is an endpoint distance', async () => {
    const result = await execCross({ ...EQUATOR_PATH, lat3: 1, lon3: 25 })
    expect(result.withinSegment).toBe(false)
    expect(result.note).toContain('outside the path segment')
    expect(result.distanceToSegmentKm).toBeCloseTo(1671.543712, 3)
    assertNoUndefined(result)
  })

  it('reports the oblique-path anchors from the oracle', async () => {
    const result = await execCross({
      lat1: 39.9042,
      lon1: 116.4074,
      lat2: 31.2304,
      lon2: 121.4737,
      lat3: 30.0,
      lon3: 120.0,
    })
    expect(result.side).toBe('right')
    expect(result.crossTrackKm).toBeCloseTo(-184.88092, 3)
    expect(result.alongTrackKm).toBeCloseTo(1133.832206, 3)
    expect(result.footLat).toBeCloseTo(30.683454, 3)
    expect(result.footLon).toBeCloseTo(121.756306, 3)
    expect(result.distanceToSegmentKm).toBeCloseTo(196.480782, 3)
    expect(result.trackBearing).toBeCloseTo(153.072675, 3)
    expect(result.bearingToFoot).toBeCloseTo(65.287362, 3)
    expect(result.note).toBeDefined()
    assertNoUndefined(result)
  })

  it('reports "on track" for a query point sitting on the path start', async () => {
    const result = await execCross({ ...EQUATOR_PATH, lat3: 0, lon3: 0 })
    expect(result.side).toBe('on track')
    expect(result.crossTrackKm).toBeCloseTo(0, 9)
    expect(result.withinSegment).toBe(true)
    assertNoUndefined(result)
  })

  it('fails closed for a 90-degree-off point and for bad inputs', async () => {
    const off = await execCross({ ...EQUATOR_PATH, lat3: 90, lon3: 0 })
    expect(off.valid).toBe(false)
    expect(off.reason).toContain('exactly 90 degrees off the path')
    const badLat = await execCross({ ...EQUATOR_PATH, lat3: 91, lon3: 0 })
    expect(badLat.valid).toBe(false)
    expect(badLat.reason).toContain('latitude 91 is out of range')
    const antipodal = await execCross({ lat1: 0, lon1: 0, lat2: 0, lon2: 180, lat3: 1, lon3: 1 })
    expect(antipodal.valid).toBe(false)
    expect(antipodal.reason).toContain('antipodal')
    assertNoUndefined(off)
    assertNoUndefined(badLat)
    assertNoUndefined(antipodal)
  })

  it('renders a compact one-line summary', async () => {
    const args = { ...EQUATOR_PATH, lat3: 1, lon3: 5 }
    const result = await execCross(args)
    const rendered = tools.geo_cross_track.output.render!(args, result)
    expect(rendered[0]!.text).toContain('111.19508 km left of the path')
    expect(rendered[0]!.text).toContain('555.975401 km along')
    expect(rendered[0]!.text).toContain('within the segment')
  })
})
