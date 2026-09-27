/**
 * Point-in-polygon test for dsh-geodesy, matching the winding semantics of
 * `sphericalPolygonArea`: the polygon is a closed sequence of great-circle
 * edges, and the answer is reported for BOTH regions the boundary delimits.
 *
 * Method: a ray (half great circle) is cast from the query point along a
 * great circle chosen so that no vertex lies on it; every edge crossing that
 * ray adds +1 or -1 depending on whether the boundary's azimuth about the
 * query point increases or decreases there (the planar winding rule, lifted
 * to the sphere). A non-zero winding means the boundary winds around the
 * point, i.e. the point is inside the region it encloses.
 *
 * Why not the cheaper "sum of tangent-plane angles at the query point"? That
 * method has an antipodal blind spot: for a point near the antipode of the
 * polygon the angles wrap spuriously and it reports "inside" for points that
 * are nowhere near the polygon (and for tiny polygons it does so at their
 * exact antipode). The crossing form has no such discontinuity.
 *
 * Two booleans come out of the winding, because a polygon on a sphere always
 * has two sides:
 *   insideEnclosed   — the everyday "is the point inside the polygon", i.e.
 *                      the region the boundary winds around.
 *   insideLeftRegion — the region to the LEFT of the directed edges, which is
 *                      the same thing for counter-clockwise vertex order and
 *                      the complement for clockwise order. This is the region
 *                      whose area `geo_area` reports as `areaKm2`.
 *
 * Points within `BOUNDARY_TOLERANCE_RAD` of an edge are reported as
 * `onBoundary` and in neither region (a boundary is not a side).
 *
 * @module dsh-geodesy/region
 */

import { DEFAULT_RADIUS_KM, type Point } from './geodesy.ts'
import { MAX_VERTICES, sphericalPolygonArea } from './area.ts'
import { crossTrack } from './path.ts'

const DEG = Math.PI / 180

/** Angular tolerance for "the point lies on the boundary" (~6 mm on Earth). */
export const BOUNDARY_TOLERANCE_RAD = 1e-9

/** Rotation step (radians) applied when the ray would run through a vertex. */
const RAY_ROTATION_STEP = 0.37

/** How many ray directions to try before giving up on a degenerate polygon. */
const RAY_ATTEMPTS = 8

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

function norm(v: Vec3): number {
  return Math.sqrt(dot(v, v))
}

function unit(v: Vec3): Vec3 {
  const n = norm(v)
  return { x: v.x / n, y: v.y / n, z: v.z / n }
}

function latLonToXyz(lat: number, lon: number): Vec3 {
  const la = lat * DEG
  const lo = lon * DEG
  return { x: Math.cos(la) * Math.cos(lo), y: Math.cos(la) * Math.sin(lo), z: Math.sin(la) }
}

/**
 * Winding number of the boundary around the query point, by signed crossings
 * of a great-circle ray. Returns undefined only when no attempt produced a
 * ray free of vertices (a contrived, measure-zero case).
 */
function windingByRayCrossings(verts: Vec3[], pHat: Vec3, la: number, lo: number): number | undefined {
  // A ray direction in the tangent plane: due north from the query point.
  let e1 = { x: -Math.sin(la) * Math.cos(lo), y: -Math.sin(la) * Math.sin(lo), z: Math.cos(la) }
  let e2 = cross(pHat, e1)
  let clean = false
  for (let attempt = 0; attempt < RAY_ATTEMPTS; attempt += 1) {
    clean = verts.every((v) => {
      const azimuth = Math.abs(Math.atan2(dot(v, e2), dot(v, e1)))
      return azimuth > 1e-9 && Math.PI - azimuth > 1e-9
    })
    if (clean) break
    e1 = unit({
      x: Math.cos(RAY_ROTATION_STEP) * e1.x + Math.sin(RAY_ROTATION_STEP) * e2.x,
      y: Math.cos(RAY_ROTATION_STEP) * e1.y + Math.sin(RAY_ROTATION_STEP) * e2.y,
      z: Math.cos(RAY_ROTATION_STEP) * e1.z + Math.sin(RAY_ROTATION_STEP) * e2.z,
    })
    e2 = cross(pHat, e1)
  }
  if (!clean) return undefined

  const nRay = unit(cross(pHat, e1))
  let total = 0
  for (let i = 0; i < verts.length; i += 1) {
    const va = verts[i]!
    const vb = verts[(i + 1) % verts.length]!
    const nEdgeRaw = cross(va, vb)
    const nEdgeLen = norm(nEdgeRaw)
    if (nEdgeLen < 1e-12) continue // consecutive duplicate/antipodal: rejected upstream
    const xRaw = cross(unit(nEdgeRaw), nRay)
    const xLen = norm(xRaw)
    if (xLen < 1e-12) continue // edge coplanar with the ray's great circle
    let x = { x: xRaw.x / xLen, y: xRaw.y / xLen, z: xRaw.z / xLen }
    if (dot(x, va) < 0 || dot(x, vb) < 0) x = { x: -x.x, y: -x.y, z: -x.z }
    // Is x between va and vb along the minor arc? Solve x = alpha*va + beta*vb.
    // (A plain "dot products are non-negative" test is not enough: the pole of
    // the edge's great circle is 90 degrees from both vertices and would pass.)
    const c = dot(va, vb)
    const oneMinusC2 = 1 - c * c
    if (oneMinusC2 < 1e-12) continue // vertices coincident or antipodal: rejected upstream
    const alpha = (dot(x, va) - c * dot(x, vb)) / oneMinusC2
    const beta = (dot(x, vb) - c * dot(x, va)) / oneMinusC2
    if (alpha <= 0 || beta <= 0) continue // crossing outside this edge's arc
    if (dot(x, e1) <= 0) continue // crossing on the opposite half of the great circle
    const along = dot(vb, x)
    const tLen = norm({ x: vb.x - along * x.x, y: vb.y - along * x.y, z: vb.z - along * x.z })
    if (tLen < 1e-12) continue
    const slope = dot({ x: (vb.x - along * x.x) / tLen, y: (vb.y - along * x.y) / tLen, z: (vb.z - along * x.z) / tLen }, e2)
    if (Math.abs(slope) < 1e-12) continue // non-transversal crossing (needs a contrived polygon)
    total += slope > 0 ? 1 : -1
  }
  return total
}

export interface PointInPolygonInfo {
  /** Point is in the region enclosed by the boundary (the ordinary polygon). */
  insideEnclosed: boolean
  /** Point is in the region LEFT of the directed edges (cf. `geo_area`). */
  insideLeftRegion: boolean
  /** Point sits on the boundary itself, within the tolerance. */
  onBoundary: boolean
  /** Winding number of the boundary around the point (0, +1 or -1); omitted on the boundary. */
  winding?: number
  /** True when the left region is the enclosed one (counter-clockwise vertex order). */
  leftIsEnclosed: boolean
  /** Area of the region LEFT of the directed edges (km²). */
  areaKm2: number
  /** Area of the other region (km²). */
  complementKm2: number
}

export interface PointInPolygonOutcome {
  result?: PointInPolygonInfo
  error?: string
}

/**
 * Test whether `point` lies inside the spherical polygon `points` (vertices in
 * boundary order, 3 to 100 of them, no consecutive duplicate or antipodal
 * vertices). Both the enclosed region and the left-of-edges region are
 * reported; see the module docs for what each one means.
 */
export function pointInPolygon(
  points: Point[],
  point: Point,
  radiusKm = DEFAULT_RADIUS_KM,
): PointInPolygonOutcome {
  const n = points.length
  if (n < 3) return { error: `a polygon needs at least 3 vertices, got ${n}` }
  if (n > MAX_VERTICES) return { error: `too many vertices (${n}); the limit is ${MAX_VERTICES}` }
  for (const vertex of points) {
    if (!Number.isFinite(vertex.lat) || !Number.isFinite(vertex.lon)) {
      return { error: 'every vertex must have finite numeric lat/lon' }
    }
    if (vertex.lat < -90 || vertex.lat > 90 || vertex.lon < -180 || vertex.lon > 180) {
      return { error: `vertex (${vertex.lat}, ${vertex.lon}) is out of range (lat [-90, 90], lon [-180, 180])` }
    }
  }
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
    return { error: 'the query point must have finite numeric lat/lon' }
  }
  if (point.lat < -90 || point.lat > 90 || point.lon < -180 || point.lon > 180) {
    return { error: `query point (${point.lat}, ${point.lon}) is out of range (lat [-90, 90], lon [-180, 180])` }
  }
  const area = sphericalPolygonArea(points, radiusKm)
  if (area.error !== undefined) return { error: area.error }
  const info = area.result!
  const leftIsEnclosed = info.excessRadians < 2 * Math.PI
  const complementKm2 = info.complementKm2

  const toleranceKm = BOUNDARY_TOLERANCE_RAD * radiusKm
  for (let i = 0; i < n; i += 1) {
    const edge = crossTrack(points[i]!, points[(i + 1) % n]!, point, radiusKm)
    // A degenerate edge result means the query point is 90 degrees off that
    // edge's great circle — it cannot be lying on the edge, so skip it.
    if (edge.error !== undefined) continue
    const edgeInfo = edge.result!
    if (Math.abs(edgeInfo.crossTrackKm) <= toleranceKm && edgeInfo.withinSegment) {
      return {
        result: {
          insideEnclosed: false,
          insideLeftRegion: false,
          onBoundary: true,
          leftIsEnclosed,
          areaKm2: info.areaKm2,
          complementKm2,
        },
      }
    }
  }

  const pHat = latLonToXyz(point.lat, point.lon)
  const verts = points.map((vertex) => latLonToXyz(vertex.lat, vertex.lon))
  const winding = windingByRayCrossings(verts, pHat, point.lat * DEG, point.lon * DEG)
  if (winding === undefined) {
    return {
      error: 'no non-degenerate ray could be cast from the query point — every candidate ray ran '
        + 'through a vertex of this polygon',
    }
  }
  // A boundary on a sphere has TWO sides, so the signed crossing sum has to be
  // calibrated: +1 means "the point is in the enclosed region and the enclosed
  // region is the left one", -1 the mirror image, 0 means the point and its
  // antipode are on the same side. `leftIsEnclosed` (from the excess sign) is
  // what tells the two cases apart; the enclosed region is then always the
  // smaller of the two, which is what `insideEnclosed` reports.
  const enclosed = winding === (leftIsEnclosed ? 1 : -1)
  return {
    result: {
      insideEnclosed: enclosed,
      insideLeftRegion: leftIsEnclosed ? enclosed : !enclosed,
      onBoundary: false,
      winding,
      leftIsEnclosed,
      areaKm2: info.areaKm2,
      complementKm2,
    },
  }
}
