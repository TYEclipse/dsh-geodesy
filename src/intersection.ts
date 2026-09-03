/**
 * Intersection of two great-circle paths for dsh-geodesy.
 *
 * A "path" is the full great circle through a start point with a given
 * initial bearing. Two distinct great circles on a sphere always cross at
 * exactly two antipodal points, so the result is deterministic: the crossing
 * nearest to the first path's start is reported as the primary point, and
 * the antipodal crossing is included alongside it.
 *
 * Implementation is pure 3D vector math (no angle-case formulas), which is
 * robust for polar regions, antipodal starts, and identical start points:
 *   n_i = unit(p_i x d_i)      circle normal (d_i = unit tangent at p_i)
 *   x   = +/- unit(n_1 x n_2)  the two crossings
 *
 * @module dsh-geodesy/intersection
 */

import { DEFAULT_RADIUS_KM, type Point } from './geodesy.ts'

const DEG = Math.PI / 180

interface Vec3 {
  x: number
  y: number
  z: number
}

function unit(v: Vec3): Vec3 {
  const n = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  return { x: v.x / n, y: v.y / n, z: v.z / n }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function clamp1(t: number): number {
  return Math.max(-1, Math.min(1, t))
}

function latLonToXyz(lat: number, lon: number): Vec3 {
  const la = lat * DEG
  const lo = lon * DEG
  return { x: Math.cos(la) * Math.cos(lo), y: Math.cos(la) * Math.sin(lo), z: Math.sin(la) }
}

function xyzToLatLon(v: Vec3): { lat: number; lon: number } {
  const u = unit(v)
  const lat = Math.asin(clamp1(u.z)) / DEG
  let lon = Math.atan2(u.y, u.x) / DEG
  lon = ((lon + 540) % 360) - 180
  return { lat, lon }
}

/** Unit tangent along the given bearing at point `p` (undefined at the poles). */
function tangentAt(p: Point, bearingDeg: number): Vec3 | undefined {
  if (Math.abs(Math.abs(p.lat) - 90) < 1e-9) return undefined // pole: no north frame
  const la = p.lat * DEG
  const lo = p.lon * DEG
  const north = { x: -Math.sin(la) * Math.cos(lo), y: -Math.sin(la) * Math.sin(lo), z: Math.cos(la) }
  const east = { x: -Math.sin(lo), y: Math.cos(lo), z: 0 }
  const th = bearingDeg * DEG
  return unit({
    x: north.x * Math.cos(th) + east.x * Math.sin(th),
    y: north.y * Math.cos(th) + east.y * Math.sin(th),
    z: north.z * Math.cos(th) + east.z * Math.sin(th),
  })
}

/** Distance in km between two unit vectors (arc length). */
function arcKm(a: Vec3, b: Vec3, radiusKm: number): number {
  return radiusKm * Math.acos(clamp1(dot(a, b)))
}

export interface IntersectionPoint {
  lat: number
  lon: number
  distanceFromStart1Km: number
  distanceFromStart2Km: number
}

export interface IntersectionOutcome {
  result?: {
    point: IntersectionPoint
    antipode: IntersectionPoint
    /** True when the primary crossing lies on the reverse side of path 1. */
    behindStart1: boolean
  }
  error?: string
}

/**
 * Compute the crossing of two great-circle paths.
 * `p1`/`p2` are the path starts, `brng1`/`brng2` their initial bearings
 * (degrees, [0, 360)). Returns an error string for coincident paths,
 * pole starts, or invalid inputs.
 */
export function greatCircleIntersection(
  p1: Point,
  brng1: number,
  p2: Point,
  brng2: number,
  radiusKm = DEFAULT_RADIUS_KM,
): IntersectionOutcome {
  const v1 = latLonToXyz(p1.lat, p1.lon)
  const v2 = latLonToXyz(p2.lat, p2.lon)
  const d1 = tangentAt(p1, brng1)
  const d2 = tangentAt(p2, brng2)
  if (d1 === undefined || d2 === undefined) {
    return { error: 'a path cannot start exactly at a pole: every bearing there is a meridian and the heading frame is undefined' }
  }
  const n1 = unit(cross(v1, d1))
  const n2 = unit(cross(v2, d2))
  const cr = cross(n1, n2)
  if (Math.sqrt(dot(cr, cr)) < 1e-12) {
    return { error: 'the two paths lie on the same great circle (coincident) — every point is a crossing' }
  }
  let x = unit(cr)
  if (dot(x, v1) < 0) x = { x: -x.x, y: -x.y, z: -x.z } // crossing nearest to start 1
  const anti = { x: -x.x, y: -x.y, z: -x.z }
  const ll = xyzToLatLon(x)
  const llAnti = xyzToLatLon(anti)
  const d1Km = arcKm(v1, x, radiusKm)
  const d2Km = arcKm(v2, x, radiusKm)
  const behindStart1 = dot(x, d1) < 0
  return {
    result: {
      point: {
        lat: ll.lat,
        lon: ll.lon,
        distanceFromStart1Km: d1Km,
        distanceFromStart2Km: d2Km,
      },
      antipode: {
        lat: llAnti.lat,
        lon: llAnti.lon,
        distanceFromStart1Km: arcKm(v1, anti, radiusKm),
        distanceFromStart2Km: arcKm(v2, anti, radiusKm),
      },
      behindStart1,
    },
  }
}
