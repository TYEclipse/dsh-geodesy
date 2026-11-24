/**
 * geo_along_path (walking a route) — v0.6.0.
 *
 * Every numeric expectation below is printed by the committed oracle; run
 * `python3 test/oracle/anchors.py` (section F, "walking a route") to see them.
 * The oracle places the point with the *direct problem* (destination at the
 * leg's initial bearing) while src/path.ts interpolates the leg's two endpoints
 * on the great circle — two independent constructions of the same point — and
 * its `--check` asserts the invariants (point is legAlongKm from its leg start,
 * along + remaining = total, fraction = along/total, the slerp point and the
 * direct point agree, a waypoint landing is that waypoint, nothing past the end
 * is ever clamped).
 *
 * ORACLE: test/oracle/anchors.py
 */
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/index.ts'
import { alongPath } from '../src/path.ts'
import { buildGeodesyTools } from '../src/tools.ts'
import { assertLossless } from './helpers/lossless-json.ts'

const tools = buildGeodesyTools(resolveConfig({}))

/** rc.x ToolDefinition.execute is typed (args, exec); tests call it single-arg (R14). */
type Exec1<TArgs, TOut> = (args: TArgs) => Promise<TOut>

type AlongOut = {
  valid: boolean
  lat?: number
  lon?: number
  latDms?: string
  lonDms?: string
  alongKm?: number
  totalKm?: number
  remainingKm?: number
  fraction?: number
  points?: number
  legs?: number
  leg?: number
  fromIndex?: number
  toIndex?: number
  legAlongKm?: number
  legLengthKm?: number
  legRemainingKm?: number
  bearing?: number
  compass?: string
  atWaypoint?: boolean
  waypointIndex?: number
  atPole?: boolean
  note?: string
  reason?: string
}

const execAlong = tools.geo_along_path.execute as unknown as Exec1<
  { points: Array<{ lat: number; lon: number }>; distanceKm: number },
  AlongOut
>

const BEIJING = { lat: 39.9042, lon: 116.4074 }
const SHANGHAI = { lat: 31.2304, lon: 121.4737 }
const HONGKONG = { lat: 22.3193, lon: 114.1694 }
const CN_ROUTE = [BEIJING, SHANGHAI, HONGKONG]

const EQUATOR_30 = [{ lat: 0, lon: 0 }, { lat: 0, lon: 30 }]
const EQUATOR_10 = [{ lat: 0, lon: 0 }, { lat: 0, lon: 10 }]
const ZIGZAG = [{ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, { lat: 5, lon: 20 }, { lat: 0, lon: 30 }]
const LOOP = [{ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, { lat: 0, lon: 20 }, { lat: 0, lon: 0 }]

describe('alongPath', () => {
  it('walks a single equatorial leg 3000 km in', () => {
    const out = alongPath(EQUATOR_30, 3000)
    expect(out.error).toBeUndefined()
    const info = out.result!
    expect(info.point.lat).toBeCloseTo(0, 9)
    expect(info.point.lon).toBeCloseTo(26.979611, 5)
    expect(info.leg).toBe(1)
    expect(info.fromIndex).toBe(0)
    expect(info.toIndex).toBe(1)
    expect(info.points).toBe(2)
    expect(info.totalKm).toBeCloseTo(3335.852407, 6)
    expect(info.alongKm).toBe(3000)
    expect(info.remainingKm).toBeCloseTo(335.852407, 6)
    expect(info.fraction).toBeCloseTo(0.8993203637, 9)
    expect(info.legAlongKm).toBe(3000)
    expect(info.legLengthKm).toBeCloseTo(3335.852407, 6)
    expect(info.legRemainingKm).toBeCloseTo(335.852407, 6)
    expect(info.bearing).toBeCloseTo(90, 9)
    expect(info.compass).toBe('E')
    expect(info.atWaypoint).toBe(false)
    expect(info.waypointIndex).toBeUndefined()
  })

  it('distance zero is the route start, with the first leg heading', () => {
    const info = alongPath(EQUATOR_10, 0).result!
    expect(info.point).toEqual({ lat: 0, lon: 0 })
    expect(info.atWaypoint).toBe(true)
    expect(info.waypointIndex).toBe(0)
    expect(info.alongKm).toBe(0)
    expect(info.fraction).toBe(0)
    expect(info.bearing).toBeCloseTo(90, 9)
    expect(info.compass).toBe('E')
    expect(info.remainingKm).toBeCloseTo(1111.950802, 6)
  })

  it('the full route length is the last waypoint, with no heading left to give', () => {
    const info = alongPath(EQUATOR_10, 1111.950802335329).result!
    expect(info.point.lat).toBeCloseTo(0, 9)
    expect(info.point.lon).toBeCloseTo(10, 9)
    expect(info.atWaypoint).toBe(true)
    expect(info.waypointIndex).toBe(1)
    expect(info.remainingKm).toBeCloseTo(0, 9)
    expect(info.fraction).toBeCloseTo(1, 9)
    expect(info.bearing).toBeUndefined()
    expect(info.compass).toBeUndefined()
  })

  it('rejects a distance past the end of the route instead of clamping it', () => {
    const out = alongPath(EQUATOR_10, 2000)
    expect(out.result).toBeUndefined()
    expect(out.error).toContain('1111.950802 km long')
    expect(out.error).toContain('beyond its end')
  })

  it('rejects a negative distance', () => {
    const out = alongPath(EQUATOR_10, -5)
    expect(out.error).toBe('distance must be zero or positive (got -5 km)')
  })

  it('rejects a non-finite distance', () => {
    expect(alongPath(EQUATOR_10, Number.NaN).error).toContain('finite')
    expect(alongPath(EQUATOR_10, Number.POSITIVE_INFINITY).error).toContain('finite')
  })

  it('walks the first leg of Beijing → Shanghai → Hong Kong', () => {
    const info = alongPath(CN_ROUTE, 500).result!
    expect(info.point.lat).toBeCloseTo(35.867287, 5)
    expect(info.point.lon).toBeCloseTo(118.918446, 5)
    expect(info.leg).toBe(1)
    expect(info.legAlongKm).toBe(500)
    expect(info.legLengthKm).toBeCloseTo(1067.311645, 6)
    expect(info.totalKm).toBeCloseTo(2294.343754, 6)
    expect(info.remainingKm).toBeCloseTo(1794.343754, 6)
    expect(info.bearing).toBeCloseTo(154.615792, 5)
    expect(info.compass).toBe('SSE')
  })

  it('turns the corner: 1200 km into the same route is on the second leg', () => {
    const info = alongPath(CN_ROUTE, 1200).result!
    expect(info.leg).toBe(2)
    expect(info.fromIndex).toBe(1)
    expect(info.toIndex).toBe(2)
    expect(info.point.lat).toBeCloseTo(30.28617, 5)
    expect(info.point.lon).toBeCloseTo(120.624597, 5)
    expect(info.legAlongKm).toBeCloseTo(132.688355, 6)
    expect(info.legLengthKm).toBeCloseTo(1227.032109, 6)
    expect(info.legRemainingKm).toBeCloseTo(1094.343754, 6)
    expect(info.bearing).toBeCloseTo(217.479044, 5)
    expect(info.compass).toBe('SW')
  })

  it('keeps walking the second leg further in', () => {
    const info = alongPath(CN_ROUTE, 1500).result!
    expect(info.point.lat).toBeCloseTo(28.131974, 5)
    expect(info.point.lon).toBeCloseTo(118.76341, 5)
    expect(info.legAlongKm).toBeCloseTo(432.688355, 6)
    expect(info.bearing).toBeCloseTo(216.570568, 5)
    expect(info.fraction).toBeCloseTo(0.6537817174, 9)
  })

  it('crosses the antimeridian without wrapping the wrong way', () => {
    const info = alongPath([{ lat: 0, lon: 170 }, { lat: 0, lon: -170 }], 150).result!
    expect(info.point.lat).toBeCloseTo(0, 9)
    expect(info.point.lon).toBeCloseTo(171.348981, 5)
    expect(info.totalKm).toBeCloseTo(2223.901605, 6)
    expect(info.remainingKm).toBeCloseTo(2073.901605, 6)
    expect(info.bearing).toBeCloseTo(90, 9)
  })

  it('lands on the pole and then refuses to invent a heading', () => {
    // A route from 80°N/0° to 80°N/180° runs over the north pole: 10° of arc.
    const info = alongPath([{ lat: 80, lon: 0 }, { lat: 80, lon: 180 }], 10 * (Math.PI / 180) * 6371.0088).result!
    expect(info.point.lat).toBeCloseTo(90, 4)
    expect(info.atPole).toBe(true)
    expect(info.bearing).toBeUndefined()
    expect(info.compass).toBeUndefined()
    expect(info.fraction).toBeCloseTo(0.5, 9)
    expect(info.totalKm).toBeCloseTo(2223.901605, 6)
  })

  it('skips a zero-length leading leg instead of walking it', () => {
    const info = alongPath([{ lat: 0, lon: 0 }, { lat: 0, lon: 0 }, { lat: 0, lon: 10 }], 1000).result!
    expect(info.leg).toBe(2)
    expect(info.fromIndex).toBe(1)
    expect(info.point.lat).toBeCloseTo(0, 9)
    expect(info.point.lon).toBeCloseTo(8.993204, 5)
    expect(info.legAlongKm).toBe(1000)
    expect(info.bearing).toBeCloseTo(90, 9)
    expect(info.atWaypoint).toBe(false)
  })

  it('reports a waypoint landing as that waypoint, with the outgoing heading', () => {
    const info = alongPath(ZIGZAG, 1111.950802335329).result!
    expect(info.atWaypoint).toBe(true)
    expect(info.waypointIndex).toBe(1)
    expect(info.point.lat).toBeCloseTo(0, 9)
    expect(info.point.lon).toBeCloseTo(10, 9)
    expect(info.bearing).toBeCloseTo(63.259795, 5)
    expect(info.compass).toBe('ENE')
    expect(info.legRemainingKm).toBeCloseTo(0, 9)
    expect(info.remainingKm).toBeCloseTo(2483.865208, 6)
  })

  it('walks inside a bent middle leg', () => {
    const info = alongPath(ZIGZAG, 1600).result!
    expect(info.leg).toBe(2)
    expect(info.point.lat).toBeCloseTo(1.973328, 5)
    expect(info.point.lon).toBeCloseTo(13.921286, 5)
    expect(info.legAlongKm).toBeCloseTo(488.049198, 6)
    expect(info.legLengthKm).toBeCloseTo(1241.932604, 6)
    expect(info.bearing).toBeCloseTo(63.327354, 5)
  })

  it('walks a closed loop', () => {
    const info = alongPath(LOOP, 1500).result!
    expect(info.leg).toBe(2)
    expect(info.point.lat).toBeCloseTo(0, 9)
    expect(info.point.lon).toBeCloseTo(13.489805, 5)
    expect(info.legAlongKm).toBeCloseTo(388.049198, 6)
    expect(info.fraction).toBeCloseTo(0.3372451364, 9)
    expect(info.bearing).toBeCloseTo(90, 9)
  })

  it('a zero-length route is one point with no fraction and no heading', () => {
    const out = alongPath([{ lat: 10, lon: 10 }, { lat: 10, lon: 10 }], 0)
    const info = out.result!
    expect(info.totalKm).toBe(0)
    expect(info.point).toEqual({ lat: 10, lon: 10 })
    expect(info.atWaypoint).toBe(true)
    expect(info.waypointIndex).toBe(0)
    expect(info.fraction).toBeUndefined()
    expect(info.bearing).toBeUndefined()
    expect(info.remainingKm).toBe(0)
  })

  it('a zero-length route rejects any positive distance', () => {
    const out = alongPath([{ lat: 10, lon: 10 }, { lat: 10, lon: 10 }], 1)
    expect(out.error).toContain('0.000000 km long')
    expect(out.error).toContain('beyond its end')
  })

  it('rejects a route with too few waypoints', () => {
    expect(alongPath([{ lat: 0, lon: 0 }], 0).error).toContain('at least 2 waypoints')
  })
})

describe('geo_along_path tool', () => {
  it('reports the rounded anchors and DMS strings of the reached point', async () => {
    const result = await execAlong({ points: EQUATOR_30, distanceKm: 3000 })
    expect(result.valid).toBe(true)
    expect(result.lat).toBeCloseTo(0, 6)
    expect(result.lon).toBeCloseTo(26.979611, 5)
    expect(result.latDms).toBe('0°0′0″N')
    expect(result.lonDms).toContain('26°')
    expect(result.alongKm).toBe(3000)
    expect(result.totalKm).toBeCloseTo(3335.852407, 6)
    expect(result.remainingKm).toBeCloseTo(335.852407, 6)
    expect(result.fraction).toBeCloseTo(0.8993203637, 9)
    expect(result.leg).toBe(1)
    expect(result.legs).toBe(1)
    expect(result.points).toBe(2)
    expect(result.bearing).toBeCloseTo(90, 6)
    expect(result.compass).toBe('E')
    expect(result.atWaypoint).toBe(false)
    expect(result.waypointIndex).toBeUndefined()
    expect(result.atPole).toBeUndefined()
    assertLossless(result)
  })

  it('omits the fields that have no honest value', async () => {
    const end = await execAlong({ points: EQUATOR_10, distanceKm: 1111.950802335329 })
    expect(end.valid).toBe(true)
    expect(end.bearing).toBeUndefined()
    expect(end.compass).toBeUndefined()
    expect(end.atWaypoint).toBe(true)
    expect(end.waypointIndex).toBe(1)

    const zero = await execAlong({ points: [{ lat: 10, lon: 10 }, { lat: 10, lon: 10 }], distanceKm: 0 })
    expect(zero.valid).toBe(true)
    expect(zero.fraction).toBeUndefined()
    expect(zero.bearing).toBeUndefined()

    const pole = await execAlong({
      points: [{ lat: 80, lon: 0 }, { lat: 80, lon: 180 }],
      distanceKm: 10 * (Math.PI / 180) * 6371.0088,
    })
    expect(pole.valid).toBe(true)
    expect(pole.atPole).toBe(true)
    expect(pole.bearing).toBeUndefined()
    expect(pole.note).toContain('pole')
    assertLossless(pole)
  })

  it('returns valid:false with a reason past the end of the route', async () => {
    const result = await execAlong({ points: EQUATOR_10, distanceKm: 5000 })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('beyond its end')
    expect(result.lat).toBeUndefined()
  })

  it('renders the point, the leg and what is left', async () => {
    const args = { points: CN_ROUTE, distanceKm: 1200 }
    const result = await execAlong(args)
    const text = tools.geo_along_path.output.render(args, result)[0]!.text
    expect(text).toContain('1200 km along this 3-waypoint route')
    expect(text).toContain('2294.343754 km total')
    expect(text).toContain('leg 2 of 2')
    expect(text).toContain('132.688355 km into a 1227.032109 km leg')
    expect(text).toContain('52.303% of the route walked')
    expect(text).toContain('heading 217.479044° SW')
    expect(text).toContain('1094.343754 km to the end of the route')
  })

  it('renders the waypoint landing and the pole caveat', async () => {
    const waypointArgs = { points: ZIGZAG, distanceKm: 1111.950802335329 }
    const waypoint = await execAlong(waypointArgs)
    const waypointText = tools.geo_along_path.output.render(waypointArgs, waypoint)[0]!.text
    expect(waypointText).toContain('exactly at waypoint 2')

    const poleArgs = { points: [{ lat: 80, lon: 0 }, { lat: 80, lon: 180 }], distanceKm: 10 * (Math.PI / 180) * 6371.0088 }
    const pole = await execAlong(poleArgs)
    const poleText = tools.geo_along_path.output.render(poleArgs, pole)[0]!.text
    expect(poleText).toContain('a pole: no longitude')
    expect(poleText).toContain('no heading')
    expect(pole.lon).toBeUndefined()
    expect(pole.lonDms).toBeUndefined()
  })

  it('renders the invalid branch as a reason, not a crash', async () => {
    const args = { points: EQUATOR_10, distanceKm: -1 }
    const result = await execAlong(args)
    const text = tools.geo_along_path.output.render(args, result)[0]!.text
    expect(text.startsWith('invalid input:')).toBe(true)
    expect(text).toContain('zero or positive')
  })
})
