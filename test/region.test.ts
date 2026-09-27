/**
 * Point-in-polygon tests: the `geo_point_in_polygon` tool surface and the
 * `src/region.ts` module behind it.
 *
 * ORACLE: test/oracle/anchors.py — every expectation below is printed by that
 * script (its cases P1-P14). The oracle rotates the sphere so the query point
 * becomes the pole and finds each ray crossing by bisection on the arc
 * parameter, while src/region.ts intersects great circles in closed form: two
 * independent routes to the same winding numbers, areas and verdicts.
 *
 * The five polygon fixtures (octant triangle both ways, clockwise small
 * square, concave pentagon, antimeridian strip, tiny box) are the same ones
 * the area tests use where they overlap, so the two tools stay comparable.
 *
 * @module dsh-geodesy/test/region
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_RADIUS_KM } from '../src/geodesy.ts'
import { BOUNDARY_TOLERANCE_RAD, pointInPolygon } from '../src/region.ts'
import { buildGeodesyTools } from '../src/tools.ts'

const tools = buildGeodesyTools({ radiusKm: DEFAULT_RADIUS_KM })

/** rc.x ToolDefinition.execute is typed (args, exec); tests call it single-arg (R14). */
type Exec1<TArgs, TOut> = (args: TArgs) => Promise<TOut>

const execPoly = tools.geo_point_in_polygon.execute as unknown as Exec1<
  { points: Array<{ lat: number; lon: number }>; lat: number; lon: number },
  {
    valid: boolean
    insideEnclosed?: boolean
    insideLeftRegion?: boolean
    onBoundary?: boolean
    vertices?: number
    areaKm2?: number
    complementKm2?: number
    regionAreaKm2?: number
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

const OCTANT_CCW = [{ lat: 0, lon: 0 }, { lat: 0, lon: 90 }, { lat: 90, lon: 0 }]
const OCTANT_CW = [{ lat: 0, lon: 0 }, { lat: 90, lon: 0 }, { lat: 0, lon: 90 }]
const SMALL_SQUARE_CW = [{ lat: 0, lon: 0 }, { lat: 0.1, lon: 0 }, { lat: 0.1, lon: 0.1 }, { lat: 0, lon: 0.1 }]
const PENTAGON_CW = [{ lat: 0, lon: 0 }, { lat: 2, lon: 0 }, { lat: 2, lon: 2 }, { lat: 1, lon: 1 }, { lat: 0, lon: 2 }]
const ANTIMERIDIAN_BOX = [{ lat: 10, lon: 170 }, { lat: 10, lon: -170 }, { lat: -10, lon: -170 }, { lat: -10, lon: 170 }]
const TINY_ANTIPODAL_BOX = [{ lat: 0.1, lon: 179.9 }, { lat: 0.1, lon: -179.9 }, { lat: -0.1, lon: -179.9 }, { lat: -0.1, lon: 179.9 }]

const OCTANT_AREA = 63758235.121609
const OCTANT_COMPLEMENT = 446307645.851263

describe('pointInPolygon', () => {
  it('places a point inside the counter-clockwise octant triangle', () => {
    const out = pointInPolygon(OCTANT_CCW, { lat: 45, lon: 45 })
    expect(out.error).toBeUndefined()
    const info = out.result!
    expect(info.winding).toBe(1)
    expect(info.insideEnclosed).toBe(true)
    expect(info.insideLeftRegion).toBe(true)
    expect(info.onBoundary).toBe(false)
    expect(info.leftIsEnclosed).toBe(true)
    expect(info.areaKm2).toBeCloseTo(OCTANT_AREA, 3)
    expect(info.complementKm2).toBeCloseTo(OCTANT_COMPLEMENT, 3)
  })

  it('places a point outside the counter-clockwise octant triangle', () => {
    const info = pointInPolygon(OCTANT_CCW, { lat: 45, lon: -45 }).result!
    expect(info.winding).toBe(0)
    expect(info.insideEnclosed).toBe(false)
    expect(info.insideLeftRegion).toBe(false)
  })

  it('keeps the two sides distinct for a clockwise wound triangle', () => {
    const inside = pointInPolygon(OCTANT_CW, { lat: 45, lon: 45 }).result!
    expect(inside.winding).toBe(-1)
    expect(inside.insideEnclosed).toBe(true)
    expect(inside.insideLeftRegion).toBe(false)
    expect(inside.leftIsEnclosed).toBe(false)
    expect(inside.areaKm2).toBeCloseTo(OCTANT_COMPLEMENT, 3)
    expect(inside.complementKm2).toBeCloseTo(OCTANT_AREA, 3)
    const outside = pointInPolygon(OCTANT_CW, { lat: 45, lon: -45 }).result!
    expect(outside.winding).toBe(0)
    expect(outside.insideEnclosed).toBe(false)
    expect(outside.insideLeftRegion).toBe(true)
  })

  it('handles a small clockwise square (area from the oracle)', () => {
    const inside = pointInPolygon(SMALL_SQUARE_CW, { lat: 0.05, lon: 0.05 }).result!
    expect(inside.winding).toBe(-1)
    expect(inside.insideEnclosed).toBe(true)
    expect(inside.complementKm2).toBeCloseTo(123.643427, 3)
    const far = pointInPolygon(SMALL_SQUARE_CW, { lat: 1, lon: 1 }).result!
    expect(far.winding).toBe(0)
    expect(far.insideEnclosed).toBe(false)
    expect(far.insideLeftRegion).toBe(true)
    expect(far.areaKm2).toBeCloseTo(510065757.329444, 1)
  })

  it('respects the notch of a concave pentagon', () => {
    const body = pointInPolygon(PENTAGON_CW, { lat: 0.5, lon: 0.5 }).result!
    expect(body.winding).toBe(-1)
    expect(body.insideEnclosed).toBe(true)
    expect(body.complementKm2).toBeCloseTo(37089.265628, 1)
    const notch = pointInPolygon(PENTAGON_CW, { lat: 0.5, lon: 1.8 }).result!
    expect(notch.winding).toBe(0)
    expect(notch.insideEnclosed).toBe(false)
    expect(notch.insideLeftRegion).toBe(true)
  })

  it('reports points on an edge and on a vertex as boundary, in neither region', () => {
    const edge = pointInPolygon(OCTANT_CCW, { lat: 0, lon: 45 }).result!
    expect(edge.onBoundary).toBe(true)
    expect(edge.insideEnclosed).toBe(false)
    expect(edge.insideLeftRegion).toBe(false)
    expect(edge.winding).toBeUndefined()
    const vertex = pointInPolygon(OCTANT_CCW, { lat: 0, lon: 0 }).result!
    expect(vertex.onBoundary).toBe(true)
    expect(vertex.insideEnclosed).toBe(false)
  })

  it('handles a polygon that straddles the antimeridian', () => {
    const inside = pointInPolygon(ANTIMERIDIAN_BOX, { lat: 0, lon: 180 }).result!
    expect(inside.winding).toBe(-1)
    expect(inside.insideEnclosed).toBe(true)
    expect(inside.complementKm2).toBeCloseTo(4969695.025489, 1)
    const far = pointInPolygon(ANTIMERIDIAN_BOX, { lat: 0, lon: 0 }).result!
    expect(far.winding).toBe(1)
    expect(far.insideEnclosed).toBe(false)
    expect(far.insideLeftRegion).toBe(true)
  })

  it('does not confuse a point with the antipode of a small polygon', () => {
    // The naive "sum of angles at the query point" method reports this point
    // as inside; the crossing method (and the oracle) do not.
    const antipode = pointInPolygon(TINY_ANTIPODAL_BOX, { lat: 0, lon: 0 }).result!
    expect(antipode.insideEnclosed).toBe(false)
    expect(antipode.insideLeftRegion).toBe(true)
    const middle = pointInPolygon(TINY_ANTIPODAL_BOX, { lat: 0, lon: 180 }).result!
    expect(middle.insideEnclosed).toBe(true)
    expect(middle.complementKm2).toBeCloseTo(494.574086, 3)
  })

  it('rejects degenerate polygons and out-of-range coordinates', () => {
    expect(pointInPolygon([], { lat: 0, lon: 0 }).error).toContain('at least 3 vertices, got 0')
    expect(pointInPolygon(OCTANT_CCW.slice(0, 2), { lat: 0, lon: 0 }).error).toContain('at least 3 vertices, got 2')
    const many = Array.from({ length: 101 }, (_, i) => ({ lat: 0, lon: (i % 90) }))
    expect(pointInPolygon(many, { lat: 1, lon: 1 }).error).toContain('too many vertices (101); the limit is 100')
    expect(pointInPolygon([{ lat: 91, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }], { lat: 0, lon: 0 }).error)
      .toContain('vertex (91, 0) is out of range')
    expect(pointInPolygon([{ lat: Number.NaN, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }], { lat: 0, lon: 0 }).error)
      .toContain('finite numeric lat/lon')
    expect(pointInPolygon(OCTANT_CCW, { lat: 0, lon: 181 }).error).toContain('query point (0, 181) is out of range')
    expect(pointInPolygon(OCTANT_CCW, { lat: Number.NaN, lon: 0 }).error).toContain('finite numeric lat/lon')
    const duplicate = pointInPolygon([{ lat: 0, lon: 0 }, { lat: 0, lon: 0 }, { lat: 1, lon: 1 }], { lat: 0.5, lon: 0.5 }).error
    expect(duplicate).toContain('identical or antipodal')
  })

  it('uses a boundary tolerance of about 6 mm', () => {
    expect(BOUNDARY_TOLERANCE_RAD).toBeCloseTo(1e-9, 12)
    expect(BOUNDARY_TOLERANCE_RAD * DEFAULT_RADIUS_KM).toBeCloseTo(0.000006371, 9)
  })
})

describe('geo_point_in_polygon', () => {
  it('returns the anchored verdict and areas for the octant triangle', async () => {
    const result = await execPoly({ points: OCTANT_CCW, lat: 45, lon: 45 })
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.insideEnclosed).toBe(true)
    expect(result.insideLeftRegion).toBe(true)
    expect(result.onBoundary).toBe(false)
    expect(result.vertices).toBe(3)
    expect(result.areaKm2).toBeCloseTo(OCTANT_AREA, 3)
    expect(result.complementKm2).toBeCloseTo(OCTANT_COMPLEMENT, 3)
    expect(result.regionAreaKm2).toBeCloseTo(OCTANT_AREA, 3)
    expect(result.note).toBeUndefined()
    assertNoUndefined(result)
  })

  it('explains clockwise winding when the left region is the complement', async () => {
    const outside = await execPoly({ points: SMALL_SQUARE_CW, lat: 1, lon: 1 })
    expect(outside.insideEnclosed).toBe(false)
    expect(outside.insideLeftRegion).toBe(true)
    expect(outside.note).toContain('clockwise vertex order')
    expect(outside.regionAreaKm2).toBeCloseTo(510065757.329444, 1)
    assertNoUndefined(outside)
  })

  it('omits the containing-region area for points on the boundary', async () => {
    const result = await execPoly({ points: OCTANT_CCW, lat: 0, lon: 45 })
    expect(result.onBoundary).toBe(true)
    expect(result.insideEnclosed).toBe(false)
    expect(result.insideLeftRegion).toBe(false)
    expect('regionAreaKm2' in result).toBe(false)
    assertNoUndefined(result)
  })

  it('reports the containing-region area for a point in the complement', async () => {
    const result = await execPoly({ points: PENTAGON_CW, lat: 0.5, lon: 1.8 })
    expect(result.insideEnclosed).toBe(false)
    expect(result.regionAreaKm2).toBeCloseTo(510028791.707244, 1)
    assertNoUndefined(result)
  })

  it('fails closed for bad inputs', async () => {
    // Schema-level rejection: a non-array `points` never reaches execute()
    // (dsh-tools validates the JSON-schema surface first — ToolArgsError).
    await expect(execPoly({ points: 'x' as unknown as Array<{ lat: number; lon: number }>, lat: 0, lon: 0 }))
      .rejects.toThrow('must be an array')
    const badPoint = await execPoly({ points: OCTANT_CCW, lat: 0, lon: 181 })
    expect(badPoint.valid).toBe(false)
    expect(badPoint.reason).toContain('longitude 181 is out of range')
    const tooFew = await execPoly({ points: OCTANT_CCW.slice(0, 2), lat: 0, lon: 0 })
    expect(tooFew.valid).toBe(false)
    expect(tooFew.reason).toContain('at least 3 vertices')
    assertNoUndefined(badPoint)
    assertNoUndefined(tooFew)
  })

  it('renders a compact one-line summary', async () => {
    const args = { points: OCTANT_CCW, lat: 45, lon: 45 }
    const result = await execPoly(args)
    const rendered = tools.geo_point_in_polygon.output.render!(args, result)
    expect(rendered[0]!.text).toContain('point is inside the polygon')
    expect(rendered[0]!.text).toContain('3-vertex polygon')
  })
})
