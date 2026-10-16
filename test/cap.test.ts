/**
 * geo_circle (spherical cap) — v0.4.0.
 *
 * Every numeric expectation below is printed by the committed oracle; run
 * `python3 test/oracle/anchors.py` (section D, "spherical cap") to see them.
 * The oracle's `--check` re-derives the area by a quasi-Monte-Carlo solid
 * angle integration, samples the boundary circle densely to confirm the box
 * extremes, and asserts the definitional identities (hemisphere = 2 pi R^2,
 * whole sphere = 4 pi R^2, tiny cap -> pi r^2).
 *
 * ORACLE: test/oracle/anchors.py
 */
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/index.ts'
import { destinationPoint } from '../src/geodesy.ts'
import { buildGeodesyTools, type CircleToolResult } from '../src/tools.ts'
import { assertLossless } from './helpers/lossless-json.ts'

const tools = buildGeodesyTools(resolveConfig({}))

/** A quarter of the Earth's circumference — the radius at which the boundary is a great circle. */
const QUARTER_CIRCUMFERENCE_KM = 10007.557221017962
/** Half the circumference — the radius at which the cap is the whole sphere. */
const HALF_CIRCUMFERENCE_KM = 20015.114442035923

describe('geo_circle geometry', () => {
  it('describes the anchored 1000 km cap on the equator', async () => {
    const result = await tools.geo_circle.execute({ lat: 0, lon: 0, radiusKm: 1000 })
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.angularRadiusDeg).toBeCloseTo(8.993204, 4)
    expect(result.areaKm2).toBeCloseTo(3135148.059427, 4)
    expect(result.surfaceFraction).toBeCloseTo(0.0061465551, 9)
    expect(result.boundaryKm).toBeCloseTo(6257.417515, 4)
    expect(result.boundaryIsGreatCircle).toBe(false)
    expect(result.minLat).toBeCloseTo(-8.993204, 4)
    expect(result.maxLat).toBeCloseTo(8.993204, 4)
    expect(result.minLon).toBeCloseTo(-8.993204, 4)
    expect(result.maxLon).toBeCloseTo(8.993204, 4)
    expect(result.lonSpanDeg).toBeCloseTo(17.986407, 4)
    expect(result.crossesAntimeridian).toBe(false)
    expect(result.coversAllLongitudes).toBe(false)
    expect(result.coversWholeSphere).toBe(false)
    expect(result.note).toBeUndefined()
  })

  it('recognises a hemisphere and its great-circle boundary', async () => {
    const result = await tools.geo_circle.execute({ lat: 0, lon: 0, radiusKm: QUARTER_CIRCUMFERENCE_KM })
    if (!result.valid) throw new Error('expected valid')
    expect(result.angularRadiusDeg).toBeCloseTo(90, 6)
    expect(result.areaKm2).toBeCloseTo(255032940.486436, 4)
    expect(result.surfaceFraction).toBeCloseTo(0.5, 9)
    expect(result.boundaryKm).toBeCloseTo(40030.228884, 4)
    expect(result.boundaryIsGreatCircle).toBe(true)
    expect(result.coversAllLongitudes).toBe(true)
    expect(result.coversWholeSphere).toBe(false)
    expect(result.note).toContain('great circle')
  })

  it('reports every longitude for a cap that reaches a pole', async () => {
    const result = await tools.geo_circle.execute({ lat: 80, lon: 10, radiusKm: 1200 })
    if (!result.valid) throw new Error('expected valid')
    expect(result.angularRadiusDeg).toBeCloseTo(10.791844, 4)
    expect(result.areaKm2).toBeCloseTo(4510534.738256, 4)
    expect(result.boundaryKm).toBeCloseTo(7495.319753, 4)
    expect(result.minLat).toBeCloseTo(69.208156, 4)
    expect(result.maxLat).toBe(90)
    expect(result.includesNorthPole).toBe(true)
    expect(result.includesSouthPole).toBe(false)
    expect(result.coversAllLongitudes).toBe(true)
    expect(result.minLon).toBe(-180)
    expect(result.maxLon).toBe(180)
    expect(result.note).toContain('pole')
  })

  it('wraps the longitude box across the antimeridian instead of inventing a span', async () => {
    const result = await tools.geo_circle.execute({ lat: 0, lon: 179.5, radiusKm: 100 })
    if (!result.valid) throw new Error('expected valid')
    expect(result.angularRadiusDeg).toBeCloseTo(0.89932, 4)
    expect(result.areaKm2).toBeCloseTo(31415.281552, 4)
    expect(result.boundaryKm).toBeCloseTo(628.292731, 4)
    expect(result.crossesAntimeridian).toBe(true)
    expect(result.minLon).toBeCloseTo(178.60068, 4)
    expect(result.maxLon).toBeCloseTo(-179.60068, 4)
    expect(result.minLon).toBeGreaterThan(result.maxLon!)
    expect(result.lonSpanDeg).toBeCloseTo(1.798641, 4)
    expect(result.coversAllLongitudes).toBe(false)
    expect(result.note).toContain('antimeridian')
  })

  it('covers the whole sphere at half the circumference', async () => {
    const result = await tools.geo_circle.execute({ lat: 0, lon: 0, radiusKm: HALF_CIRCUMFERENCE_KM })
    if (!result.valid) throw new Error('expected valid')
    expect(result.angularRadiusDeg).toBeCloseTo(180, 6)
    expect(result.areaKm2).toBeCloseTo(510065880.972872, 4)
    expect(result.surfaceFraction).toBeCloseTo(1, 9)
    expect(result.boundaryKm).toBeCloseTo(0, 6)
    expect(result.coversWholeSphere).toBe(true)
    expect(result.includesNorthPole).toBe(true)
    expect(result.includesSouthPole).toBe(true)
    expect(result.note).toContain('whole sphere')
  })

  it('approaches the planar disc area when the cap is tiny', async () => {
    const result = await tools.geo_circle.execute({ lat: 0, lon: 0, radiusKm: 1 })
    if (!result.valid) throw new Error('expected valid')
    expect(result.areaKm2).toBeCloseTo(3.141593, 6)
    expect(Math.abs(result.areaKm2! - Math.PI) / Math.PI).toBeLessThan(1e-5)
    expect(result.boundaryKm).toBeCloseTo(6.283185, 6)
    expect(result.angularRadiusDeg).toBeCloseTo(0.008993, 6)
  })

  it('grows the area monotonically with the radius', async () => {
    const areas: number[] = []
    for (const radiusKm of [100, 1000, 5000, 10000]) {
      const result = await tools.geo_circle.execute({ lat: 12, lon: 34, radiusKm })
      if (!result.valid) throw new Error('expected valid')
      areas.push(result.areaKm2!)
    }
    for (let i = 1; i < areas.length; i += 1) {
      expect(areas[i]!).toBeGreaterThan(areas[i - 1]!)
    }
  })
})

describe('geo_circle containment', () => {
  it('places an inside point correctly', async () => {
    const result = await tools.geo_circle.execute({
      lat: 39.9042,
      lon: 116.4074,
      radiusKm: 300,
      pointLat: 40.5,
      pointLon: 117,
    })
    if (!result.valid) throw new Error('expected valid')
    expect(result.pointDistanceKm).toBeCloseTo(83.198018, 4)
    expect(result.containsPoint).toBe(true)
    expect(result.pointOnBoundary).toBe(false)
    // the box may not be used as a containment test — the point is inside the
    // cap even though a naive planar box would call some of it outside
    expect(result.minLat).toBeCloseTo(37.206239, 4)
    expect(result.maxLat).toBeCloseTo(42.602161, 4)
  })

  it('places an outside point correctly', async () => {
    const result = await tools.geo_circle.execute({
      lat: 39.9042,
      lon: 116.4074,
      radiusKm: 300,
      pointLat: 35,
      pointLon: 110,
    })
    if (!result.valid) throw new Error('expected valid')
    expect(result.pointDistanceKm).toBeCloseTo(785.252907, 4)
    expect(result.containsPoint).toBe(false)
    expect(result.pointOnBoundary).toBe(false)
  })

  it('reports a point placed exactly on the radius as a boundary hit', async () => {
    // The probe comes from the *unrounded* direct problem. Note why: every
    // coordinate a tool hands back is rounded to 1e-6 degrees, which is about
    // 11 cm of arc — coarser than the 6 mm boundary tolerance, so a probe
    // quoted from a rounded value would land just inside or just outside the
    // circle rather than on it.
    const probe = destinationPoint({ lat: 0, lon: 0 }, 90, 300)
    expect(probe.lon).toBeCloseTo(2.697961091, 6)
    const viaTool = await tools.geo_destination.execute({ lat: 0, lon: 0, bearing: 90, distance: 300 })
    if (!viaTool.valid) throw new Error('expected valid destination')
    expect(viaTool.lon).toBeCloseTo(probe.lon, 5)
    const result = await tools.geo_circle.execute({
      lat: 0,
      lon: 0,
      radiusKm: 300,
      pointLat: probe.lat,
      pointLon: probe.lon,
    })
    if (!result.valid) throw new Error('expected valid')
    expect(result.pointDistanceKm).toBeCloseTo(300, 6)
    expect(result.pointOnBoundary).toBe(true)
    expect(result.containsPoint).toBe(false)
  })

  it('omits the containment fields when no query point is given', async () => {
    const result = await tools.geo_circle.execute({ lat: 0, lon: 0, radiusKm: 500 })
    if (!result.valid) throw new Error('expected valid')
    expect(result.pointDistanceKm).toBeUndefined()
    expect(result.containsPoint).toBeUndefined()
    expect(result.pointOnBoundary).toBeUndefined()
  })
})

describe('geo_circle input handling', () => {
  it('rejects a non-positive radius', async () => {
    const zero = await tools.geo_circle.execute({ lat: 0, lon: 0, radiusKm: 0 })
    expect(zero.valid).toBe(false)
    expect(zero.reason).toContain('positive')
    const negative = await tools.geo_circle.execute({ lat: 0, lon: 0, radiusKm: -5 })
    expect(negative.valid).toBe(false)
  })

  it('rejects an out-of-range centre', async () => {
    const result = await tools.geo_circle.execute({ lat: 91, lon: 0, radiusKm: 100 })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('latitude')
  })

  it('requires pointLat and pointLon together', async () => {
    const result = await tools.geo_circle.execute({ lat: 0, lon: 0, radiusKm: 100, pointLat: 1 })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('together')
  })

  it('validates the query point', async () => {
    const result = await tools.geo_circle.execute({ lat: 0, lon: 0, radiusKm: 100, pointLat: 0, pointLon: 200 })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('query point')
  })

  it('keeps the configurable sphere radius meaningful (moon-sized sphere)', async () => {
    const moon = buildGeodesyTools(resolveConfig({ radiusKm: 1737.4 }))
    const result = await moon.geo_circle.execute({ lat: 0, lon: 0, radiusKm: 100 })
    if (!result.valid) throw new Error('expected valid')
    // 100 km is a bigger share of a smaller sphere
    const earth = await tools.geo_circle.execute({ lat: 0, lon: 0, radiusKm: 100 })
    if (!earth.valid) throw new Error('expected valid')
    expect(result.surfaceFraction!).toBeGreaterThan(earth.surfaceFraction!)
  })

  it('keeps success and failure results lossless-JSON safe', async () => {
    assertLossless(await tools.geo_circle.execute({ lat: 0, lon: 0, radiusKm: 1000 }))
    assertLossless(await tools.geo_circle.execute({ lat: 0, lon: 0, radiusKm: 1000, pointLat: 1, pointLon: 2 }))
    assertLossless(await tools.geo_circle.execute({ lat: 0, lon: 0, radiusKm: 0 }))
    assertLossless(await tools.geo_circle.execute({ lat: 0, lon: 0, radiusKm: 100, pointLat: 1 }))
  })

  it('renders a human-readable summary', async () => {
    const result = await tools.geo_circle.execute({ lat: 0, lon: 0, radiusKm: 1000 }) as CircleToolResult
    const rendered = tools.geo_circle.output!.render!(
      { lat: 0, lon: 0, radiusKm: 1000 },
      result,
    )[0]!.text as string
    expect(rendered).toContain('spherical cap')
    expect(rendered).toContain('3135148.059427 km²')
    expect(rendered).toContain('6257.417515 km')
  })

  it('renders the containment verdict when a query point is given', async () => {
    const result = await tools.geo_circle.execute({
      lat: 39.9042,
      lon: 116.4074,
      radiusKm: 300,
      pointLat: 40.5,
      pointLon: 117,
    }) as CircleToolResult
    const rendered = tools.geo_circle.output!.render!(
      { lat: 39.9042, lon: 116.4074, radiusKm: 300, pointLat: 40.5, pointLon: 117 },
      result,
    )[0]!.text as string
    expect(rendered).toContain('inside the cap')
  })
})
