/**
 * Cross-track / along-track geometry for dsh-geodesy.
 *
 * Answers the everyday navigation question "how far am I off this path, and
 * where is my closest point on it?" with 3D unit-vector math (no angle-case
 * formulas), so poles, antipodal starts and coincident points behave.
 *
 * Definitions used throughout (and echoed in the tool description):
 *   crossTrackKm > 0  <=>  the query point lies to the LEFT of the path
 *                          p1 -> p2, where "left" is the right-hand-rule side
 *                          of the direction of travel seen from outside the
 *                          sphere.
 *   alongTrackKm  > 0  <=>  the perpendicular foot lies AHEAD of p1 along the
 *                          path; negative means it lies behind p1.
 *
 * The perpendicular foot is `unit(v3 - (v3 . n) n)` where `n = unit(v1 x v2)`
 * is the great-circle normal; the along-track distance is the signed arc from
 * `v1` to that foot measured about `n`.
 *
 * @module dsh-geodesy/path
 */

import { DEFAULT_RADIUS_KM, compassPoint, haversineKm, initialBearing, type Point } from './geodesy.ts'

const DEG = Math.PI / 180

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

function unit(v: Vec3): Vec3 {
  const n = Math.sqrt(dot(v, v))
  return { x: v.x / n, y: v.y / n, z: v.z / n }
}

function clamp1(t: number): number {
  return Math.max(-1, Math.min(1, t))
}

function latLonToXyz(lat: number, lon: number): Vec3 {
  const la = lat * DEG
  const lo = lon * DEG
  return { x: Math.cos(la) * Math.cos(lo), y: Math.cos(la) * Math.sin(lo), z: Math.sin(la) }
}

function xyzToLatLon(v: Vec3): Point {
  const u = unit(v)
  const lat = Math.asin(clamp1(u.z)) / DEG
  const lon = ((Math.atan2(u.y, u.x) / DEG + 540) % 360) - 180
  return { lat, lon }
}

export interface CrossTrackInfo {
  /** Signed perpendicular distance to the great circle through p1,p2 (km). */
  crossTrackKm: number
  /** Signed distance from p1 along the path to the perpendicular foot (km). */
  alongTrackKm: number
  /** The perpendicular foot: the closest point on the path's great circle. */
  foot: Point
  /** True when the foot lies between p1 and p2 (inclusive). */
  withinSegment: boolean
  /** Distance from the query point to the nearest point of the segment p1-p2. */
  distanceToSegmentKm: number
  /** Great-circle length of the path p1-p2. */
  pathLengthKm: number
}

export interface CrossTrackOutcome {
  result?: CrossTrackInfo
  error?: string
}

/**
 * Cross-track / along-track data for `p3` relative to the path `p1 -> p2`.
 * Returns an error string when the path is degenerate (coincident or
 * antipodal endpoints) or when `p3` is exactly 90 degrees off the path
 * (every point of the path is then equidistant, so no foot is unique).
 */
export function crossTrack(
  p1: Point,
  p2: Point,
  p3: Point,
  radiusKm = DEFAULT_RADIUS_KM,
): CrossTrackOutcome {
  const v1 = latLonToXyz(p1.lat, p1.lon)
  const v2 = latLonToXyz(p2.lat, p2.lon)
  const v3 = latLonToXyz(p3.lat, p3.lon)
  const nRaw = cross(v1, v2)
  const nLen = Math.sqrt(dot(nRaw, nRaw))
  if (nLen < 1e-12) {
    return {
      error: dot(v1, v2) > 0
        ? 'the path start and end coincide — a path needs two distinct points'
        : 'the path endpoints are antipodal — infinitely many great circles pass through them',
    }
  }
  const n = { x: nRaw.x / nLen, y: nRaw.y / nLen, z: nRaw.z / nLen }
  const crossTrackKm = Math.asin(clamp1(dot(v3, n))) * radiusKm
  const proj = {
    x: v3.x - dot(v3, n) * n.x,
    y: v3.y - dot(v3, n) * n.y,
    z: v3.z - dot(v3, n) * n.z,
  }
  if (Math.sqrt(dot(proj, proj)) < 1e-12) {
    return {
      error: 'the query point is exactly 90 degrees off the path — every point of the path is '
        + 'equidistant, so the perpendicular foot is not unique',
    }
  }
  const footVec = unit(proj)
  const pathAngle = Math.atan2(nLen, dot(v1, v2))
  const alongAngle = Math.atan2(dot(cross(v1, footVec), n), dot(v1, footVec))
  const withinSegment = alongAngle >= -1e-12 && alongAngle <= pathAngle + 1e-12
  const alongTrackKm = alongAngle * radiusKm
  return {
    result: {
      crossTrackKm,
      alongTrackKm,
      foot: xyzToLatLon(footVec),
      withinSegment,
      distanceToSegmentKm: withinSegment
        ? Math.abs(crossTrackKm)
        : Math.min(haversineKm(p3, p1, radiusKm), haversineKm(p3, p2, radiusKm)),
      pathLengthKm: pathAngle * radiusKm,
    },
  }
}

/** One leg of a multi-point path. */
export interface PolylineLeg {
  /** 1-based index of the leg (the leg from waypoint i to waypoint i+1). */
  leg: number
  /** 0-based index of the leg's start waypoint. */
  fromIndex: number
  /** 0-based index of the leg's end waypoint. */
  toIndex: number
  /** Great-circle length of this leg in km. */
  distanceKm: number
  /** Total distance from the first waypoint to this leg's end, in km. */
  cumulativeKm: number
  /** Initial bearing of this leg in degrees; absent when the leg is zero-length (no heading exists). */
  initialBearing?: number
  /** Compass point for the leg's heading; absent when the leg is zero-length. */
  compass?: string
}

export interface PolylineInfo {
  /** Number of waypoints on the path. */
  points: number
  /** Every leg, in order. */
  legs: PolylineLeg[]
  /** Sum of all leg lengths, in km. */
  totalKm: number
  /** Great-circle distance from the first waypoint straight to the last, in km. */
  straightKm: number
  /** totalKm - straightKm: how much further the route is than flying direct, in km. */
  detourKm: number
  /** Distance from the last waypoint back to the first, in km. */
  closureKm: number
  /** True when the last waypoint is the first waypoint (the path closes a loop). */
  closesLoop: boolean
  /** Length of the longest leg, in km. */
  maxLegKm: number
  /** Length of the shortest leg, in km. */
  minLegKm: number
  /** 1-based numbers of the zero-length legs (identical consecutive waypoints). */
  zeroLengthLegs: number[]
}

export interface PolylineOutcome {
  result?: PolylineInfo
  error?: string
}

/** Fewest / most waypoints a multi-point path may have. */
export const POLYLINE_MIN_POINTS = 2
export const POLYLINE_MAX_POINTS = 50

/**
 * Path totals for an ordered list of waypoints: per-leg distances and
 * headings, the running total, and how much longer the route is than the
 * straight line between its endpoints.
 *
 * A zero-length leg (two identical consecutive waypoints) is reported with
 * its length 0 and *no* heading — the bearing of a zero-length great circle
 * is undefined, and inventing 0° there would be a silent wrong answer.
 * `detourKm` is derived from the two reported totals so a reader can check it
 * by hand; whether it may be expressed as a percentage is decided by the
 * caller (`straightKm === 0` means there is no percentage).
 */
export function polylinePath(points: Point[], radiusKm = DEFAULT_RADIUS_KM): PolylineOutcome {
  if (points.length < POLYLINE_MIN_POINTS) {
    return { error: `a path needs at least ${POLYLINE_MIN_POINTS} waypoints (got ${points.length})` }
  }
  if (points.length > POLYLINE_MAX_POINTS) {
    return { error: `a path supports at most ${POLYLINE_MAX_POINTS} waypoints (got ${points.length})` }
  }
  for (let index = 0; index < points.length; index += 1) {
    const p = points[index]!
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) {
      return { error: 'every waypoint must have finite numeric lat/lon' }
    }
    if (p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180) {
      return { error: `waypoint ${index + 1} (${p.lat}, ${p.lon}) is out of range (lat [-90, 90], lon [-180, 180])` }
    }
  }
  const legs: PolylineLeg[] = []
  const zeroLengthLegs: number[] = []
  let cumulative = 0
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!
    const to = points[index + 1]!
    const distanceKm = haversineKm(from, to, radiusKm)
    cumulative += distanceKm
    const leg: PolylineLeg = {
      leg: index + 1,
      fromIndex: index,
      toIndex: index + 1,
      distanceKm,
      cumulativeKm: cumulative,
    }
    if (distanceKm < 1e-9) {
      zeroLengthLegs.push(index + 1)
    } else {
      leg.initialBearing = initialBearing(from, to)
      leg.compass = compassPoint(leg.initialBearing)
    }
    legs.push(leg)
  }
  const closureKm = haversineKm(points[points.length - 1]!, points[0]!, radiusKm)
  const distances = legs.map((leg) => leg.distanceKm)
  return {
    result: {
      points: points.length,
      legs,
      totalKm: cumulative,
      straightKm: haversineKm(points[0]!, points[points.length - 1]!, radiusKm),
      detourKm: cumulative - haversineKm(points[0]!, points[points.length - 1]!, radiusKm),
      closureKm,
      closesLoop: closureKm < 1e-9,
      maxLegKm: Math.max(...distances),
      minLegKm: Math.min(...distances),
      zeroLengthLegs,
    },
  }
}
