/**
 * Bounding-box tests: the `geo_bbox` tool surface and the `src/bbox.ts`
 * module behind it.
 *
 * ORACLE: test/oracle/anchors.py — every numeric expectation below is printed
 * by that script (its cases E1-E15 in section E). The oracle finds each arc's
 * latitude extreme with Clairaut's relation and solves `d(lat)/ds = 0` for the
 * along-track distance (scalar trigonometry, slerp for the point itself),
 * while src/bbox.ts projects the pole onto the great circle's plane and works
 * in 3D unit vectors — two independent routes to the same numbers. The
 * oracle's own `--check` then validates every case against dense sampling of
 * the arcs (every sample inside the box, both edges attained).
 *
 * @module dsh-geodesy/test/bbox
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_RADIUS_KM } from '../src/geodesy.ts'
import { BBOX_MAX_POINTS, BBOX_MIN_POINTS, normalizeLon, sphericalBBox } from '../src/bbox.ts'
import { buildGeodesyTools } from '../src/tools.ts'
import { assertLossless } from './helpers/lossless-json.ts'

const tools = buildGeodesyTools({ radiusKm: DEFAULT_RADIUS_KM })

/** rc.x ToolDefinition.execute is typed (args, exec); tests call it single-arg (R14). */
type Exec1<TArgs, TOut> = (args: TArgs) => Promise<TOut>

interface BBoxOut {
  valid: boolean
  shape?: string
  boxes?: Array<{ minLat: number; maxLat: number; minLon: number; maxLon: number }>
  minLat?: number
  maxLat?: number
  lonSpanDeg?: number
  crossesAntimeridian?: boolean
  coversAllLongitudes?: boolean
  includesNorthPole?: boolean
  includesSouthPole?: boolean
  vertices?: number
  legs?: number
  bulgeKm?: number
  note?: string
  reason?: string
}

const execBBox = tools.geo_bbox.execute as unknown as Exec1<
  { points?: Array<{ lat: number; lon: number }>; path?: Array<{ lat: number; lon: number }> },
  BBoxOut
>

function asPoints(pairs: Array<[number, number]>): Array<{ lat: number; lon: number }> {
  return pairs.map(([lat, lon]) => ({ lat, lon }))
}

const NORTH40_PATH: Array<[number, number]> = [[40, 0], [40, 120]]
const PACIFIC_PATH: Array<[number, number]> = [[0, 170], [0, -170]]
const BEIJING: [number, number] = [39.9042, 116.4074]
const SHANGHAI: [number, number] = [31.2304, 121.4737]
const HONGKONG: [number, number] = [22.3193, 114.1694]

describe('sphericalBBox — vertices vs arcs', () => {
  it('gives the same box for two equatorial points in both modes, with no bulge', () => {
    const pointsBox = sphericalBBox('points', asPoints([[0, 0], [0, 10]]))
    const pathBox = sphericalBBox('path', asPoints([[0, 0], [0, 10]]))
    expect(pointsBox.error).toBeUndefined()
    expect(pathBox.error).toBeUndefined()
    for (const info of [pointsBox.result!, pathBox.result!]) {
      expect(info.minLat).toBeCloseTo(0, 6)
      expect(info.maxLat).toBeCloseTo(0, 6)
      expect(info.lonSpanDeg).toBeCloseTo(10, 6)
      expect(info.boxes).toHaveLength(1)
      expect(info.boxes[0]!.minLon).toBeCloseTo(0, 6)
      expect(info.boxes[0]!.maxLon).toBeCloseTo(10, 6)
      expect(info.crossesAntimeridian).toBe(false)
    }
    expect(pointsBox.result!.legs).toBe(0)
    expect(pathBox.result!.legs).toBe(1)
    expect(pathBox.result!.bulgeKm).toBeCloseTo(0, 6)
  })

  it('lets a 40°N route bulge to 59.2°N while the vertex box stays at 40°N', () => {
    const pointsBox = sphericalBBox('points', asPoints(NORTH40_PATH)).result!
    const pathBox = sphericalBBox('path', asPoints(NORTH40_PATH)).result!
    expect(pointsBox.maxLat).toBeCloseTo(40, 6)
    expect(pointsBox.minLat).toBeCloseTo(40, 6)
    // The arc through 40°N at 120° of longitude separation peaks well north of
    // either waypoint — the number the tool description quotes.
    expect(pathBox.maxLat).toBeCloseTo(59.210267, 5)
    expect(pathBox.minLat).toBeCloseTo(40, 6)
    expect(pathBox.bulgeKm).toBeCloseTo(2136.087177, 3)
    expect(pathBox.lonSpanDeg).toBeCloseTo(120, 6)
  })

  it('mirrors the bulge in the southern hemisphere', () => {
    const pathBox = sphericalBBox('path', asPoints([[-40, 0], [-40, 120]])).result!
    expect(pathBox.minLat).toBeCloseTo(-59.210267, 5)
    expect(pathBox.maxLat).toBeCloseTo(-40, 6)
    expect(pathBox.bulgeKm).toBeCloseTo(2136.087177, 3)
    expect(pathBox.includesSouthPole).toBe(false)
  })

  it('keeps a multi-leg city route at its waypoint extremes', () => {
    const pathBox = sphericalBBox('path', asPoints([BEIJING, SHANGHAI, HONGKONG])).result!
    expect(pathBox.minLat).toBeCloseTo(22.3193, 6)
    expect(pathBox.maxLat).toBeCloseTo(39.9042, 6)
    expect(pathBox.lonSpanDeg).toBeCloseTo(7.3043, 4)
    expect(pathBox.boxes[0]!.minLon).toBeCloseTo(114.1694, 6)
    expect(pathBox.boxes[0]!.maxLon).toBeCloseTo(121.4737, 6)
    expect(pathBox.bulgeKm).toBeCloseTo(0, 6)
    expect(pathBox.legs).toBe(2)
  })
})

describe('sphericalBBox — antimeridian', () => {
  it('returns two boxes for a 20° route across ±180° instead of a reversed pair', () => {
    const info = sphericalBBox('path', asPoints(PACIFIC_PATH)).result!
    expect(info.crossesAntimeridian).toBe(true)
    expect(info.boxes).toHaveLength(2)
    expect(info.lonSpanDeg).toBeCloseTo(20, 6)
    expect(info.boxes[0]!.minLon).toBeCloseTo(170, 6)
    expect(info.boxes[0]!.maxLon).toBeCloseTo(180, 6)
    expect(info.boxes[1]!.minLon).toBeCloseTo(-180, 6)
    expect(info.boxes[1]!.maxLon).toBeCloseTo(-170, 6)
  })

  it('widens a reversed min/max pair into a 2° box for -179° → 179°', () => {
    const info = sphericalBBox('path', asPoints([[0, -179], [0, 179]])).result!
    expect(info.lonSpanDeg).toBeCloseTo(2, 6)
    expect(info.crossesAntimeridian).toBe(true)
    expect(info.boxes[0]!.minLon).toBeCloseTo(179, 6)
    expect(info.boxes[1]!.maxLon).toBeCloseTo(-179, 6)
  })

  it('does not split a route that only touches the antimeridian at its start', () => {
    const info = sphericalBBox('path', asPoints([[0, 180], [10, 170]])).result!
    expect(info.crossesAntimeridian).toBe(false)
    expect(info.boxes).toHaveLength(1)
    expect(info.boxes[0]!.minLon).toBeCloseTo(170, 6)
    expect(info.boxes[0]!.maxLon).toBeCloseTo(180, 6)
    expect(info.lonSpanDeg).toBeCloseTo(10, 6)
  })
})

describe('sphericalBBox — poles and degenerate shapes', () => {
  it('spans every longitude when the shortest path runs over the pole', () => {
    const info = sphericalBBox('path', asPoints([[80, 0], [80, 180]])).result!
    expect(info.includesNorthPole).toBe(true)
    expect(info.coversAllLongitudes).toBe(true)
    expect(info.lonSpanDeg).toBeCloseTo(360, 6)
    expect(info.maxLat).toBeCloseTo(90, 9)
    expect(info.minLat).toBeCloseTo(80, 6)
    expect(info.boxes).toHaveLength(1)
    expect(info.boxes[0]!.minLon).toBeCloseTo(-180, 6)
    expect(info.boxes[0]!.maxLon).toBeCloseTo(180, 6)
    expect(info.bulgeKm).toBeCloseTo(1111.950802, 3)
  })

  it('reports a single longitude for a due-north route along one meridian', () => {
    const info = sphericalBBox('path', asPoints([[0, 5], [10, 5], [20, 5]])).result!
    expect(info.lonSpanDeg).toBeCloseTo(0, 9)
    expect(info.boxes[0]!.minLon).toBeCloseTo(5, 6)
    expect(info.boxes[0]!.maxLon).toBeCloseTo(5, 6)
    expect(info.minLat).toBeCloseTo(0, 6)
    expect(info.maxLat).toBeCloseTo(20, 6)
    expect(info.crossesAntimeridian).toBe(false)
  })

  it('ignores a zero-length leg instead of failing', () => {
    const info = sphericalBBox('path', asPoints([[0, 0], [0, 0], [0, 10]])).result!
    expect(info.legs).toBe(2)
    expect(info.lonSpanDeg).toBeCloseTo(10, 6)
    expect(info.bulgeKm).toBeCloseTo(0, 6)
  })

  it('refuses an antipodal leg: its great circle is not unique', () => {
    const outcome = sphericalBBox('path', asPoints([[0, 0], [0, 180]]))
    expect(outcome.result).toBeUndefined()
    expect(outcome.error).toMatch(/leg 1/)
    expect(outcome.error).toMatch(/antipodal/)
  })

  it('takes the widest gap out of the longitude circle for scattered points', () => {
    const info = sphericalBBox('points', asPoints([[10, 10], [-20, 100], [30, -120]])).result!
    expect(info.minLat).toBeCloseTo(-20, 6)
    expect(info.maxLat).toBeCloseTo(30, 6)
    expect(info.lonSpanDeg).toBeCloseTo(220, 6)
    expect(info.boxes[0]!.minLon).toBeCloseTo(-120, 6)
    expect(info.boxes[0]!.maxLon).toBeCloseTo(100, 6)
    expect(normalizeLon(190)).toBeCloseTo(-170, 9)
  })
})

describe('geo_bbox tool surface', () => {
  it('requires exactly one of points or path', async () => {
    const neither = await execBBox({})
    expect(neither.valid).toBe(false)
    expect(neither.reason).toMatch(/exactly one of points/)
    const both = await execBBox({ points: asPoints([[0, 0], [1, 1]]), path: asPoints([[0, 0], [1, 1]]) })
    expect(both.valid).toBe(false)
    expect(both.reason).toMatch(/exactly one of points/)
  })

  it('enforces the point-count bounds', async () => {
    expect((await execBBox({ points: asPoints([[0, 0]]) })).reason).toMatch(
      new RegExp(`at least ${BBOX_MIN_POINTS}`),
    )
    const tooMany = Array.from({ length: BBOX_MAX_POINTS + 1 }, (_value, index) => ({ lat: index / 100, lon: 0 }))
    expect((await execBBox({ points: tooMany })).reason).toMatch(new RegExp(`at most ${BBOX_MAX_POINTS}`))
  })

  it('names the offending point and reports bad coordinates', async () => {
    const out = await execBBox({ points: asPoints([[0, 0], [91, 0]]) })
    expect(out.valid).toBe(false)
    expect(out.reason).toMatch(/point 2/)
    expect(out.reason).toMatch(/latitude 91 is out of range/)
  })

  it('returns JSON-safe values and a note that the points box is vertices-only', async () => {
    const out = await execBBox({ points: asPoints(NORTH40_PATH) })
    assertLossless(out)
    expect(out.valid).toBe(true)
    expect(out.shape).toBe('points')
    expect(out.vertices).toBe(2)
    expect(out.legs).toBe(0)
    expect(out.bulgeKm).toBeUndefined()
    expect(out.note).toMatch(/covers the given coordinates only/)
    expect(out.note).toMatch(/pass path instead/)
  })

  it('flags the pole case in the note and keeps the same numbers as the module', async () => {
    const out = await execBBox({ path: asPoints([[80, 0], [80, 180]]) })
    assertLossless(out)
    expect(out.coversAllLongitudes).toBe(true)
    expect(out.note).toMatch(/spans every longitude/)
    expect(out.maxLat).toBeCloseTo(90, 9)
    expect(out.boxes).toHaveLength(1)
  })

  it('renders a wrapping box as two boxes, not as a broken range', async () => {
    const args = { path: asPoints(PACIFIC_PATH) }
    const out = await execBBox(args)
    const text = tools.geo_bbox.output.render(args, out)[0]!.text
    expect(text).toMatch(/wraps the antimeridian/)
    expect(text).toMatch(/170°\.\.180°/)
    expect(text).toMatch(/-180°\.\.-170°/)
    expect(text).toMatch(/width 20°/)
  })

  it('renders the bulge for a route that climbs past its waypoints', async () => {
    const args = { path: asPoints(NORTH40_PATH) }
    const out = await execBBox(args)
    const text = tools.geo_bbox.output.render(args, out)[0]!.text
    expect(text).toMatch(/arcs reach 2136\.087177 km further/)
    expect(text).toMatch(/latitude 40° to 59\.210267°/)
  })

  it('renders an invalid call without leaking undefined', async () => {
    const out = await execBBox({})
    const text = tools.geo_bbox.output.render({}, out)[0]!.text
    expect(text).toMatch(/^invalid input: /)
    expect(text).not.toMatch(/undefined/)
  })
})
