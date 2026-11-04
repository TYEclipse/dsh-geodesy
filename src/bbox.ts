/**
 * Spherical bounding boxes for dsh-geodesy.
 *
 * A bounding box on a sphere is where almost every hand-rolled implementation
 * goes quietly wrong, so this module is explicit about the three cases:
 *
 *   1. **The box of a route is not the box of its waypoints.** A great-circle
 *      arc between two waypoints can reach latitudes that neither waypoint
 *      has (a 40°N → 40°N crossing of 120° of longitude climbs to ~48.5°N).
 *      `shape: 'path'` therefore looks for the latitude extreme of every leg
 *      and includes it; `shape: 'points'` does not, and says so.
 *   2. **A box that reaches a pole spans every longitude.** Nothing sensible
 *      can be said about minLon/maxLon once a pole is inside, so the box is
 *      reported as the full range with `coversAllLongitudes: true`.
 *   3. **A box that wraps the antimeridian needs two boxes.** The minimal
 *      longitude interval is found by cutting the longitude circle at its
 *      largest gap; when that interval crosses ±180° it is returned as two
 *      boxes, each with minLon < maxLon, instead of a reversed pair nobody
 *      can use in a map query.
 *
 * The latitude extreme of a great circle through unit vectors v1, v2 is the
 * projection of the north pole onto the circle's plane,
 * `m = unit(z - (z·n) n)` with `n = unit(v1 × v2)`: m is the point on the
 * circle with the largest z, its antipode the smallest. `|m| = 0` means the
 * circle is the equator. Whether that extreme belongs to the *arc* is decided
 * by measuring the signed angle from v1 about n, exactly like the
 * cross-track module does.
 *
 * @module dsh-geodesy/bbox
 */

import { DEFAULT_RADIUS_KM, validatePoint, type Point } from './geodesy.ts'

const DEG = Math.PI / 180
/** Arc tolerance for "this point is on this leg": 1e-9 rad ≈ 6 mm on Earth. */
const ARC_TOL_RAD = 1e-9
/** Below this norm a cross product has no usable direction. */
const DEGENERATE = 1e-12

interface Vec3 {
  x: number
  y: number
  z: number
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

function length(v: Vec3): number {
  return Math.sqrt(dot(v, v))
}

function unit(v: Vec3): Vec3 {
  const n = length(v)
  return { x: v.x / n, y: v.y / n, z: v.z / n }
}

function clamp1(t: number): number {
  return Math.max(-1, Math.min(1, t))
}

function toXyz(lat: number, lon: number): Vec3 {
  const la = lat * DEG
  const lo = lon * DEG
  return { x: Math.cos(la) * Math.cos(lo), y: Math.cos(la) * Math.sin(lo), z: Math.sin(la) }
}

/** Normalise a longitude into [-180, 180) so that ±180 is one value. */
export function normalizeLon(lon: number): number {
  return ((lon + 540) % 360) - 180
}

/** Signed angle from `from` to `to`, measured about `axis` (radians, (-pi, pi]). */
function angleAbout(from: Vec3, to: Vec3, axis: Vec3): number {
  return Math.atan2(dot(cross(from, to), axis), dot(from, to))
}

function withinArc(angle: number, pathAngle: number, tol = ARC_TOL_RAD): boolean {
  return angle >= -tol && angle <= pathAngle + tol
}

export type BBoxShape = 'points' | 'path'

/** One axis-aligned latitude/longitude box; always minLat <= maxLat, minLon <= maxLon. */
export interface BoundingBox {
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
}

export interface BBoxInfo {
  /** What the box is guaranteed to contain: the vertices, or the whole route. */
  shape: BBoxShape
  /** One box, or two when the longitude interval wraps the antimeridian. */
  boxes: BoundingBox[]
  /** Southern edge of the latitude extent (degrees). */
  minLat: number
  /** Northern edge of the latitude extent (degrees). */
  maxLat: number
  /** True longitude width in degrees (0 to 360). */
  lonSpanDeg: number
  /** True when two boxes are needed because the interval crosses ±180°. */
  crossesAntimeridian: boolean
  /** True when a pole is inside the box, so every longitude is included. */
  coversAllLongitudes: boolean
  includesNorthPole: boolean
  includesSouthPole: boolean
  /** Number of input points. */
  vertices: number
  /** Number of analysed legs (0 for a point set). */
  legs: number
  /**
   * Route mode only: how many km the arcs reach beyond the latitude extent of
   * the waypoints themselves (0 when the waypoints are already the extremes).
   */
  bulgeKm?: number
}

export interface BBoxOutcome {
  result?: BBoxInfo
  error?: string
}

/** Fewest / most points a bounding box may be computed from. */
export const BBOX_MIN_POINTS = 2
export const BBOX_MAX_POINTS = 50

interface LegExtremes {
  /** Latitude (deg) of the arc's highest point, when that point is on the leg. */
  maxLat?: number
  /** Latitude (deg) of the arc's lowest point, when that point is on the leg. */
  minLat?: number
  /** True when the leg crosses the antimeridian between its endpoints. */
  crossesAntimeridian: boolean
}

/**
 * Latitude extremes and antimeridian crossing of one leg's great-circle arc.
 * Returns an error string for an antipodal leg (no unique great circle) and
 * an empty result for a zero-length leg (identical endpoints).
 */
function analyseLeg(a: Point, b: Point): LegExtremes | string {
  const v1 = toXyz(a.lat, a.lon)
  const v2 = toXyz(b.lat, b.lon)
  const normalRaw = cross(v1, v2)
  const normalLen = length(normalRaw)
  if (normalLen < DEGENERATE) {
    if (dot(v1, v2) > 0) return { crossesAntimeridian: false }
    return 'its endpoints are antipodal — infinitely many great circles pass through them, '
      + 'so there is no unique arc to bound'
  }
  const n = { x: normalRaw.x / normalLen, y: normalRaw.y / normalLen, z: normalRaw.z / normalLen }
  const pathAngle = Math.atan2(normalLen, dot(v1, v2))
  const out: LegExtremes = { crossesAntimeridian: false }

  // Highest / lowest latitude of the whole circle: the north pole projected
  // onto the circle's plane. |m| == 0 means the circle is the equator, whose
  // extremes are already its endpoints.
  const mRaw = { x: -n.z * n.x, y: -n.z * n.y, z: 1 - n.z * n.z }
  if (length(mRaw) >= DEGENERATE) {
    const top = unit(mRaw)
    const bottom = { x: -top.x, y: -top.y, z: -top.z }
    if (withinArc(angleAbout(v1, top, n), pathAngle)) out.maxLat = Math.asin(clamp1(top.z)) / DEG
    if (withinArc(angleAbout(v1, bottom, n), pathAngle)) out.minLat = Math.asin(clamp1(bottom.z)) / DEG
  }

  // The antimeridian is the set {y = 0, x < 0}; intersect it with the circle.
  if (Math.abs(n.z) >= DEGENERATE) {
    const denominator = Math.hypot(n.x, n.z)
    if (denominator >= DEGENERATE) {
      const xAbs = Math.abs(n.z) / denominator
      if (xAbs > DEGENERATE) {
        const x = -xAbs
        const crossing = { x, y: 0, z: (-n.x * x) / n.z }
        if (withinArc(angleAbout(v1, crossing, n), pathAngle)) out.crossesAntimeridian = true
      }
    }
  }
  return out
}

/**
 * Minimal interval on the longitude circle that contains every longitude in
 * `lons`: cut the circle at its largest gap, keep the complement. Returned as
 * a start longitude plus a width, so a wrapping interval is expressible
 * (`start + span > 180`).
 */
function minimalLonInterval(lons: number[]): { start: number; span: number } {
  const sorted = [...new Set(lons.map(normalizeLon))].sort((a, b) => a - b)
  if (sorted.length === 0) return { start: 0, span: 360 }
  if (sorted.length === 1) return { start: sorted[0]!, span: 0 }
  let bestGap = -1
  let start = sorted[0]!
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]!
    const next = index + 1 < sorted.length ? sorted[index + 1]! : sorted[0]! + 360
    const gap = next - current
    if (gap > bestGap) {
      bestGap = gap
      start = index + 1 < sorted.length ? sorted[index + 1]! : sorted[0]!
    }
  }
  return { start, span: 360 - bestGap }
}

/**
 * Bounding box of a point set (`shape: 'points'`) or of a route
 * (`shape: 'path'`, whose legs are the great-circle arcs between consecutive
 * points). Distances only enter through `bulgeKm`; the box itself is angular.
 */
export function sphericalBBox(
  shape: BBoxShape,
  points: Point[],
  radiusKm = DEFAULT_RADIUS_KM,
): BBoxOutcome {
  if (!Array.isArray(points)) return { error: 'points must be an array of {lat, lon} objects' }
  if (points.length < BBOX_MIN_POINTS) {
    return { error: `a bounding box needs at least ${BBOX_MIN_POINTS} points (got ${points.length})` }
  }
  if (points.length > BBOX_MAX_POINTS) {
    return { error: `a bounding box supports at most ${BBOX_MAX_POINTS} points (got ${points.length})` }
  }
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!
    const reason = validatePoint(point.lat, point.lon)
    if (reason !== undefined) return { error: `point ${index + 1}: ${reason}` }
  }

  let vertexMaxLat = -Infinity
  let vertexMinLat = Infinity
  const lons: number[] = []
  for (const point of points) {
    vertexMaxLat = Math.max(vertexMaxLat, point.lat)
    vertexMinLat = Math.min(vertexMinLat, point.lat)
    lons.push(normalizeLon(point.lon))
  }

  let maxLat = vertexMaxLat
  let minLat = vertexMinLat
  let northBulgeDeg = 0
  let southBulgeDeg = 0
  if (shape === 'path') {
    for (let index = 0; index < points.length - 1; index += 1) {
      const leg = analyseLeg(points[index]!, points[index + 1]!)
      if (typeof leg === 'string') return { error: `leg ${index + 1}: ${leg}` }
      if (leg.maxLat !== undefined) {
        maxLat = Math.max(maxLat, leg.maxLat)
        northBulgeDeg = Math.max(northBulgeDeg, leg.maxLat - vertexMaxLat)
      }
      if (leg.minLat !== undefined) {
        minLat = Math.min(minLat, leg.minLat)
        southBulgeDeg = Math.max(southBulgeDeg, vertexMinLat - leg.minLat)
      }
      if (leg.crossesAntimeridian) lons.push(-180)
    }
  }

  const includesNorthPole = maxLat >= 90 - 1e-12
  const includesSouthPole = minLat <= -90 + 1e-12
  const coversAllLongitudes = includesNorthPole || includesSouthPole

  let boxes: BoundingBox[]
  let lonSpanDeg = 360
  if (coversAllLongitudes) {
    boxes = [{ minLat, maxLat, minLon: -180, maxLon: 180 }]
  } else {
    const interval = minimalLonInterval(lons)
    lonSpanDeg = interval.span
    const end = interval.start + interval.span
    if (end <= 180 + 1e-9) {
      boxes = [{ minLat, maxLat, minLon: interval.start, maxLon: Math.min(180, end) }]
    } else {
      boxes = [
        { minLat, maxLat, minLon: interval.start, maxLon: 180 },
        { minLat, maxLat, minLon: -180, maxLon: end - 360 },
      ]
    }
  }

  const info: BBoxInfo = {
    shape,
    boxes,
    minLat,
    maxLat,
    lonSpanDeg,
    crossesAntimeridian: boxes.length === 2,
    coversAllLongitudes,
    includesNorthPole,
    includesSouthPole,
    vertices: points.length,
    legs: shape === 'path' ? points.length - 1 : 0,
  }
  if (shape === 'path') {
    info.bulgeKm = Math.max(0, northBulgeDeg, southBulgeDeg) * DEG * radiusKm
  }
  return { result: info }
}
