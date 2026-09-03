#!/usr/bin/env python3
"""
Independent anchor oracle for dsh-geodesy v0.2.0 (rhumb / intersection / area).

Every number here is derived from first principles (closed-form spherical
trigonometry, exact octant geometry, planar shoelace limits, numeric
integration) — NOT from the TypeScript implementation. Values are printed as
JSON and hard-coded into the vitest assertions.

Rhumb (loxodrome) closed form:
  dpsi = ln(tan(pi/4 + phi2/2) / tan(pi/4 + phi1/2))
  q    = dphi / dpsi  (cos(phi1) when |dpsi| < 1e-12)
  dist = R * sqrt(dphi^2 + q^2 * dlambda^2)
  brng = atan2(dlambda, dpsi)
Numeric oracle: march tiny great-circle steps at the *computed* constant
bearing; the summed great-circle distance converges to the rhumb distance and
the landing point converges to the endpoint. This is an independent method.

Intersection of two great-circle paths (vector method):
  unit(x) = x/|x|; circle normal n_i = unit(p_i x d_i) where d_i is the unit
  tangent along bearing brng_i at p_i. Intersections are +/- unit(n1 x n2).
  Coincident circles: |n1 x n2| ~ 0. Start-on-other-circle: |p2 . n1| ~ 0.
  Trivial exact cases: equator x equator (coincident), equator x meridian,
  meridian x meridian (meet at pole).

Spherical polygon area (Girard / spherical excess):
  interior angle at vertex i = pi + atan2(v_i . (w_i x u_i), w_i . u_i)
  with w_i/u_i the unit tangents toward prev/next vertices.
  E = sum(interior) - (n-2)pi ; area = R^2 * E (region left of CCW edges).
  Exact anchor: octant triangle (0,0),(0,90),(90,0) -> E = pi/2, area = pi/2 R^2.
  Planar limit: small polygons match the shoelace planar area to O((size/R)^2).
"""
import json
import math

R = 6371.0088  # IUGG mean Earth radius, km

D2R = math.pi / 180.0


def unit(x, y, z):
    n = math.sqrt(x * x + y * y + z * z)
    return (x / n, y / n, z / n)


def latlon_to_xyz(lat, lon):
    la, lo = lat * D2R, lon * D2R
    return (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def xyz_to_latlon(v):
    v = unit(*v)
    return (math.asin(max(-1.0, min(1.0, v[2]))) / D2R,
            math.atan2(v[1], v[0]) / D2R)


def normalize_lon(lon):
    return ((lon + 180.0) % 360.0) - 180.0


# ---------------------------------------------------------------- rhumb ----

def rhumb_closed(a, b):
    la1, lo1 = a[0] * D2R, a[1] * D2R
    la2, lo2 = b[0] * D2R, b[1] * D2R
    dphi = la2 - la1
    dlmb = lo2 - lo1
    dpsi = math.log(math.tan(math.pi / 4 + la2 / 2) / math.tan(math.pi / 4 + la1 / 2))
    q = dphi / dpsi if abs(dpsi) > 1e-12 else math.cos(la1)
    dist = R * math.sqrt(dphi * dphi + q * q * dlmb * dlmb)
    brng = (math.atan2(dlmb, dpsi) / D2R) % 360.0
    return dist, brng


def gc_destination(start, bearing_deg, dist_km):
    """Direct problem on the sphere (same math as the v0.1.0 plugin)."""
    la1, lo1 = start[0] * D2R, start[1] * D2R
    th, d = bearing_deg * D2R, dist_km / R
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(th))
    lo2 = lo1 + math.atan2(math.sin(th) * math.sin(d) * math.cos(la1),
                           math.cos(d) - math.sin(la1) * math.sin(la2))
    return (la2 / D2R, normalize_lon(lo2 / D2R))


def gc_distance(a, b):
    la1, lo1 = a[0] * D2R, a[1] * D2R
    la2, lo2 = b[0] * D2R, b[1] * D2R
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(h)))


def rhumb_numeric(a, b):
    """Independent oracle: fixed-bearing integration in small GC steps."""
    dist_c, brng = rhumb_closed(a, b)
    step = 5.0  # km
    pos = list(a)
    total = 0.0
    for _ in range(5000):
        rem = dist_c - total
        if rem <= 0:
            break
        s = min(step, rem)
        nxt = gc_destination(pos, brng, s)
        total += gc_distance(pos, nxt)
        pos = nxt
        if gc_distance(pos, b) < 1e-6:
            break
    return total, pos


# ---------------------------------------------------------- intersection ----

def tangent(p, brng_deg):
    la, lo = p[0] * D2R, p[1] * D2R
    north = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
    east = (-math.sin(lo), math.cos(lo), 0.0)
    th = brng_deg * D2R
    return unit(*(north[i] * math.cos(th) + east[i] * math.sin(th) for i in range(3)))


def intersect_paths(p1, brng1, p2, brng2):
    v1, v2 = latlon_to_xyz(*p1), latlon_to_xyz(*p2)
    d1, d2 = tangent(p1, brng1), tangent(p2, brng2)
    n1, n2 = unit(*cross(v1, d1)), unit(*cross(v2, d2))
    cr = cross(n1, n2)
    if math.sqrt(dot(cr, cr)) < 1e-10:
        return None, 'coincident'  # same great circle
    x = unit(*cr)
    if dot(x, v1) < 0:  # report the crossing nearest to p1 along circle 1
        x = (-x[0], -x[1], -x[2])
    d1km = R * math.acos(max(-1.0, min(1.0, dot(v1, x))))
    d2km = R * math.acos(max(-1.0, min(1.0, dot(v2, x))))
    return (xyz_to_latlon(x), d1km, d2km), None


def gc_bearing(a, b):
    la1, lo1 = a[0] * D2R, a[1] * D2R
    la2, lo2 = b[0] * D2R, b[1] * D2R
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return (math.atan2(y, x) / D2R) % 360.0


def cross_track_km(p_start, p_pt, brng_path):
    """Cross-track distance of p_pt from the great circle through p_start along brng_path."""
    d = gc_distance(p_start, p_pt) / R
    th = (gc_bearing(p_start, p_pt) - brng_path) * D2R
    return abs(math.asin(math.sin(d) * math.sin(th))) * R


# ------------------------------------------------------------------ area ----

def polygon_area(points):
    verts = [latlon_to_xyz(*p) for p in points]
    n = len(verts)
    total_interior = 0.0
    for i in range(n):
        v = verts[i]
        wp = verts[(i - 1) % n]
        wn = verts[(i + 1) % n]
        # unit tangent toward previous / next vertex (normalization is
        # essential: raw projected differences carry FP dust at |w|,|u| ~ 1e-3
        # whose ratio flips atan2 arguments)
        w = unit(*(wp[j] - dot(wp, v) * v[j] for j in range(3)))
        u = unit(*(wn[j] - dot(wn, v) * v[j] for j in range(3)))
        interior = math.atan2(dot(v, cross(u, w)), dot(w, u)) % (2 * math.pi)
        total_interior += interior
    excess = total_interior - (n - 2) * math.pi
    area = R * R * excess
    perim = sum(gc_distance(points[i], points[(i + 1) % n]) for i in range(n))
    return area, perim, excess


def planar_shoelace_km2(points, ref_lat):
    """Planar shoelace area scaled by local km-per-degree at ref_lat."""
    km_per_deg_lat = R * D2R
    km_per_deg_lon = R * D2R * math.cos(ref_lat * D2R)
    pts = [(p[1] * km_per_deg_lon, p[0] * km_per_deg_lat) for p in points]
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


out = {}

# ---- rhumb anchors -----------------------------------------------------------
out['rhumb'] = {}
for key, a, b in [
    ('equator_quarter', (0, 0), (0, 90)),
    ('parallel_45', (45, 0), (45, 90)),
    ('general_10_10_20_30', (10, 10), (20, 30)),
    ('southward_10_0_-10_30', (10, 0), (-10, 30)),
    ('zero', (12.5, -77.2), (12.5, -77.2)),
]:
    d, brng = rhumb_closed(a, b)
    num_d, num_end = rhumb_numeric(a, b) if d > 0 else (0.0, list(a))
    out['rhumb'][key] = {
        'distance': round(d, 6),
        'bearing': round(brng, 6),
        'numericDistance': round(num_d, 6),
        'numericEndLat': round(num_end[0], 6),
        'numericEndLon': round(num_end[1], 6),
        'gc': round(gc_distance(a, b), 6),
    }

# ---- intersection anchors ----------------------------------------------------
out['intersect'] = {}
# exact: equator (east from (0,0)) x meridian (north from (0,90)) -> (0,90)
res, err = intersect_paths((0, 0), 90, (0, 90), 0)
out['intersect']['eq_x_meridian'] = {
    'lat': round(res[0][0], 6), 'lon': round(res[0][1], 6),
    'd1': round(res[1], 6), 'd2': round(res[2], 6), 'err': err,
}
# exact: two meridians meet at the north pole -> (90, 0)
res, err = intersect_paths((0, 0), 0, (0, 90), 0)
out['intersect']['meridians'] = {
    'lat': round(res[0][0], 6), 'lon': round(res[0][1], 6),
    'd1': round(res[1], 6), 'd2': round(res[2], 6), 'err': err,
}
# exact: same point, different bearings -> the common point itself
res, err = intersect_paths((30, 60), 45, (30, 60), 150)
out['intersect']['same_start'] = {
    'lat': round(res[0][0], 6), 'lon': round(res[0][1], 6),
    'd1': round(res[1], 6), 'd2': round(res[2], 6), 'err': err,
}
# coincident: equator from (0,0) and equator from (0,40) — same great circle
_, err = intersect_paths((0, 0), 90, (0, 40), 90)
out['intersect']['coincident'] = {'err': err}
_, err = intersect_paths((0, 0), 90, (0, 40), 270)
out['intersect']['coincident_reverse'] = {'err': err}
# start on other path: (10,30) brng 60, (20,40) brng 200
res, err = intersect_paths((10, 30), 60, (20, 40), 200)
out['intersect']['general1'] = {
    'lat': round(res[0][0], 6), 'lon': round(res[0][1], 6),
    'd1': round(res[1], 6), 'd2': round(res[2], 6), 'err': err,
    'xt1': round(cross_track_km((10, 30), res[0], 60), 6),
    'xt2': round(cross_track_km((20, 40), res[0], 200), 6),
}
res, err = intersect_paths((50, 0), 60, (30, 45), 300)
out['intersect']['general2'] = {
    'lat': round(res[0][0], 6), 'lon': round(res[0][1], 6),
    'd1': round(res[1], 6), 'd2': round(res[2], 6), 'err': err,
    'xt1': round(cross_track_km((50, 0), res[0], 60), 6),
    'xt2': round(cross_track_km((30, 45), res[0], 300), 6),
    'brng1': round(gc_bearing((50, 0), res[0]), 6),
    'brng2': round(gc_bearing((30, 45), res[0]), 6),
}

# ---- area anchors ------------------------------------------------------------
out['area'] = {}
# exact octant triangle (CCW): E = pi/2, area = pi/2 * R^2
octant = [(0, 0), (0, 90), (90, 0)]
area, perim, excess = polygon_area(octant)
out['area']['octant_ccw'] = {
    'area': round(area, 4), 'perimeter': round(perim, 4), 'excess': round(excess, 10),
}
# same octant wound CW -> left region is the complement: E = 7pi/2
area, perim, excess = polygon_area([(0, 0), (90, 0), (0, 90)])
out['area']['octant_cw'] = {
    'area': round(area, 4), 'perimeter': round(perim, 4), 'excess': round(excess, 10),
}
# small square vs planar shoelace
sq = [(0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)]
area, perim, excess = polygon_area(sq)
out['area']['small_square'] = {
    'area': round(area, 6), 'perimeter': round(perim, 6),
    'planar': round(planar_shoelace_km2(sq, 0.05), 6),
}
# reflex pentagon vs planar shoelace
pent = [(0, 0), (2, 0), (2, 2), (1, 1), (0, 2)]
area, perim, excess = polygon_area(pent)
out['area']['reflex_pentagon_cw'] = {
    'area': round(area, 4), 'perimeter': round(perim, 4),
    'planar': round(planar_shoelace_km2(pent, 1.0), 4),
    'complement': round(4 * math.pi * R * R - area, 4),
}
# same pentagon wound CCW (reversed) -> left region is the pentagon itself,
# reflex vertex at (1,1) with interior angle ~270 degrees
pent_ccw = [(0, 0), (0, 2), (1, 1), (2, 2), (2, 0)]
area, perim, excess = polygon_area(pent_ccw)
out['area']['reflex_pentagon_ccw'] = {
    'area': round(area, 4), 'perimeter': round(perim, 4),
    'planar': round(planar_shoelace_km2(pent_ccw, 1.0), 4),
    'excess': round(excess, 10),
}

print(json.dumps(out, indent=2))
