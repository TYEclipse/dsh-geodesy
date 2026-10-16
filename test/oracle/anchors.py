#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Single independent oracle for every dsh-geodesy numeric anchor.

Why this file is committed: every numeric expectation in the TypeScript tests
must come from an *independent* implementation — never from the code under
test and never from mental arithmetic (the "guessed expectation" failure mode
that this pipeline has recorded repeatedly). Running this script reproduces,
value by value, every anchor quoted in the test suite.

The implementation here deliberately differs from the TypeScript one in the
method it uses, not just in the language:

* great-circle distance / bearings / direct problem: classical closed forms
  (haversine, forward azimuth) in plain Python floats.
* rhumb line: the closed loxodrome formula **plus** a numeric integration
  that marches small great-circle steps at the computed constant bearing.
* great-circle path intersection: 3D normals ``n_i = unit(p_i x d_i)`` and
  ``+/- unit(n1 x n2)``.
* polygon area: spherical excess from interior angles (Girard) — and, in the
  point-in-polygon section, a second, entirely different derivation for the
  same quantity.
* cross-track / along-track: scalar spherical trigonometry (Movable Type
  Scripts), while ``src/path.ts`` works in 3D unit vectors and produces the
  foot with the *direct* formula rather than a projection.
* point in polygon: rotate the sphere so the query point becomes the pole,
  then count signed ray crossings by *bisection* on the arc parameter (no
  antipodal blind spot, unlike the naive "sum of angles" shortcut).
* spherical cap (v0.4): closed forms for area / boundary length / box, plus
  (in ``--check``) a quasi-Monte-Carlo solid-angle integration and a dense
  sampling of the boundary circle.
* route totals (v0.4): plain summation of the haversine legs, with the
  triangle-inequality and closure invariants asserted in ``--check``.

Sections (printed in this order by a bare run):
  A  v0.1 anchors — great-circle distance/bearings, destination, DMS, compass
  B  v0.2 anchors — rhumb, path intersection, polygon area (JSON)
  C  v0.3 anchors — cross-track / along-track, point in polygon
  D  v0.4 anchors — multi-leg route totals, spherical cap

Usage:
  python3 test/oracle/anchors.py            # print every anchor (human-readable)
  python3 test/oracle/anchors.py --check    # self-check against definitional
                                            # rulers / public values; rc=1 on failure
"""

import argparse
import json
import math
import sys
from typing import cast

R = 6371.0088  # IUGG mean Earth radius, km
DEG = math.pi / 180.0
BOUNDARY_TOL_RAD = 1e-9  # "on the boundary" tolerance: ~6 mm of arc
BOUNDARY_TOL_KM = BOUNDARY_TOL_RAD * R


# ── generic closed forms (section A / C helpers) ──────────────────────────
def hav_km(a, b, radius=R):
    """Great-circle distance in km, haversine, on a sphere of `radius`."""
    la1, lo1 = math.radians(a[0]), math.radians(a[1])
    la2, lo2 = math.radians(b[0]), math.radians(b[1])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(h)))


def initial_bearing(a, b):
    """Initial great-circle bearing a -> b in degrees [0, 360)."""
    la1, lo1 = math.radians(a[0]), math.radians(a[1])
    la2, lo2 = math.radians(b[0]), math.radians(b[1])
    dlo = lo2 - lo1
    y = math.sin(dlo) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dlo)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def bearing_pair(a, b):
    """(initial bearing a->b, final bearing at b) — final = reverse of b->a."""
    return initial_bearing(a, b), (initial_bearing(b, a) + 180.0) % 360.0


def destination(start, bearing_deg, distance_km, radius=R):
    """Direct problem: point at `bearing_deg` and `distance_km` from `start`."""
    la1, lo1 = math.radians(start[0]), math.radians(start[1])
    th = math.radians(bearing_deg)
    d = distance_km / radius
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(th))
    lo2 = lo1 + math.atan2(
        math.sin(th) * math.sin(d) * math.cos(la1),
        math.cos(d) - math.sin(la1) * math.sin(la2),
    )
    return (math.degrees(la2), ((math.degrees(lo2) + 540.0) % 360.0) - 180.0)


def midpoint(a, b):
    """Half-way point along the great circle between `a` and `b`."""
    la1, lo1 = math.radians(a[0]), math.radians(a[1])
    la2, lo2 = math.radians(b[0]), math.radians(b[1])
    dlo = lo2 - lo1
    bx = math.cos(la2) * math.cos(dlo)
    by = math.cos(la2) * math.sin(dlo)
    la3 = math.atan2(math.sin(la1) + math.sin(la2), math.sqrt((math.cos(la1) + bx) ** 2 + by ** 2))
    lo3 = lo1 + math.atan2(by, math.cos(la1) + bx)
    return (math.degrees(la3), ((math.degrees(lo3) + 540.0) % 360.0) - 180.0)


def clamp(x, lo=-1.0, hi=1.0):
    return max(lo, min(hi, x))


def compass_name(bearing_deg):
    """16-wind compass point, the same rule the plugin uses."""
    idx = int(((bearing_deg % 360.0) / 22.5 + 0.5) % 16)
    names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
             'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
    return names[idx]


def dms_to_decimal(deg, minutes=0.0, seconds=0.0):
    """Definitional DMS -> decimal degrees conversion (the parser's rule)."""
    return deg + minutes / 60.0 + seconds / 3600.0


def normalize_lon(lon):
    return ((lon + 540.0) % 360.0) - 180.0


# ── 3D vector helpers ─────────────────────────────────────────────────────
def unit(v):
    n = math.sqrt(dot(v, v))
    return (v[0] / n, v[1] / n, v[2] / n)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def xyz(p):
    la, lo = math.radians(p[0]), math.radians(p[1])
    return (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))


def xyz_to_latlon(v):
    u = unit(v)
    return (math.asin(clamp(u[2])) / DEG, math.atan2(u[1], u[0]) / DEG)


def tangent(p, brng_deg):
    """Unit tangent at `p` along `brng_deg` (the heading of a path starting there)."""
    la, lo = math.radians(p[0]), math.radians(p[1])
    north = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
    east = (-math.sin(lo), math.cos(lo), 0.0)
    th = math.radians(brng_deg)
    return unit(tuple(north[i] * math.cos(th) + east[i] * math.sin(th) for i in range(3)))


# ── rhumb line (section B) ────────────────────────────────────────────────
def rhumb_closed(a, b):
    """Closed-form loxodrome distance (km) and constant bearing (deg)."""
    la1, lo1 = a[0] * DEG, a[1] * DEG
    la2, lo2 = b[0] * DEG, b[1] * DEG
    dphi = la2 - la1
    dlmb = lo2 - lo1
    dpsi = math.log(math.tan(math.pi / 4 + la2 / 2) / math.tan(math.pi / 4 + la1 / 2))
    q = dphi / dpsi if abs(dpsi) > 1e-12 else math.cos(la1)
    dist = R * math.sqrt(dphi * dphi + q * q * dlmb * dlmb)
    brng = (math.atan2(dlmb, dpsi) / DEG) % 360.0
    return dist, brng


def rhumb_numeric(a, b, step_km=5.0):
    """Independent check: march small great-circle steps at the constant bearing."""
    dist_c, brng = rhumb_closed(a, b)
    pos = list(a)
    total = 0.0
    for _ in range(5000):
        rem = dist_c - total
        if rem <= 0:
            break
        s = min(step_km, rem)
        nxt = destination(pos, brng, s)
        total += hav_km(pos, nxt)
        pos = nxt
        if hav_km(pos, b) < 1e-6:
            break
    return total, pos


# ── great-circle path intersection (section B) ────────────────────────────
def intersect_paths(p1, brng1, p2, brng2):
    """Crossing of two great circles; returns (latlon, d1_km, d2_km) or (None, reason)."""
    v1, v2 = xyz(p1), xyz(p2)
    d1, d2 = tangent(p1, brng1), tangent(p2, brng2)
    n1, n2 = unit(cross(v1, d1)), unit(cross(v2, d2))
    cr = cross(n1, n2)
    if math.sqrt(dot(cr, cr)) < 1e-10:
        return None, 'coincident'  # same great circle
    x = unit(cr)
    if dot(x, v1) < 0:  # report the crossing nearest to p1 along circle 1
        x = (-x[0], -x[1], -x[2])
    d1km = R * math.acos(clamp(dot(v1, x)))
    d2km = R * math.acos(clamp(dot(v2, x)))
    return (xyz_to_latlon(x), d1km, d2km), None


def cross_track_gc_km(p_start, p_pt, brng_path):
    """Distance of p_pt from the great circle through p_start along brng_path."""
    d = hav_km(p_start, p_pt) / R
    th = (initial_bearing(p_start, p_pt) - brng_path) * DEG
    return abs(math.asin(math.sin(d) * math.sin(th))) * R


# ── polygon area, two independent derivations (sections B / C) ────────────
def polygon_area_girard(points):
    """Interior-angle (Girard) area of the region LEFT of the directed edges."""
    verts = [xyz(p) for p in points]
    n = len(verts)
    total_interior = 0.0
    for i in range(n):
        v = verts[i]
        wp = verts[(i - 1) % n]
        wn = verts[(i + 1) % n]
        # Normalization matters: raw projected differences at |w|,|u| ~ 1e-3
        # carry FP dust whose ratio flips the atan2 arguments.
        w = unit(tuple(wp[j] - dot(wp, v) * v[j] for j in range(3)))
        u = unit(tuple(wn[j] - dot(wn, v) * v[j] for j in range(3)))
        total_interior += math.atan2(dot(v, cross(u, w)), dot(w, u)) % (2 * math.pi)
    excess = total_interior - (n - 2) * math.pi
    area = R * R * excess
    perim = sum(hav_km(points[i], points[(i + 1) % n]) for i in range(n))
    return area, perim, excess


def tangent_toward(v, t):
    d = dot(t, v)
    raw = (t[0] - d * v[0], t[1] - d * v[1], t[2] - d * v[2])
    n = math.sqrt(dot(raw, raw))
    if n < 1e-9:
        return None
    return (raw[0] / n, raw[1] / n, raw[2] / n)


def polygon_left_area_km2(points):
    """Second derivation of the left-region area (used by point-in-polygon)."""
    n = len(points)
    verts = [xyz(p) for p in points]
    total = 0.0
    for i in range(n):
        v = verts[i]
        w = tangent_toward(v, verts[(i - 1) % n])
        u = tangent_toward(v, verts[(i + 1) % n])
        a = math.atan2(dot(v, cross(u, w)), dot(w, u))
        total += a if a >= 0 else a + 2 * math.pi
    excess = total - (n - 2) * math.pi
    return R * R * excess


def planar_shoelace_km2(points, ref_lat):
    """Planar shoelace area scaled by the local km-per-degree at ref_lat."""
    km_per_deg_lat = R * DEG
    km_per_deg_lon = R * DEG * math.cos(ref_lat * DEG)
    pts = [(p[1] * km_per_deg_lon, p[0] * km_per_deg_lat) for p in points]
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


# ── cross-track / along-track, scalar closed forms (section C) ────────────
def cross_track(p1, p2, p3, radius=R):
    """Cross-track / along-track data for p3 relative to the path p1 -> p2.

    Sign conventions (documented once, used everywhere):
      cross_track_km > 0 <=> the point lies to the LEFT of the path direction,
      where "left" is the right-hand-rule side of p1 -> p2 as seen from
      outside the sphere (the Movable Type formula returns the opposite sign).
      along_track_km > 0 <=> the perpendicular foot lies ahead of p1.
    """
    out: dict = {"degenerate": None}
    path_len = hav_km(p1, p2, radius)
    out["path_length_km"] = path_len
    out["track_bearing"] = initial_bearing(p1, p2)
    if path_len < 1e-9:
        out["degenerate"] = "coincident path endpoints"
        return out

    d13 = hav_km(p1, p3, radius) / radius  # angular distance, radians
    t13 = math.radians(initial_bearing(p1, p3))
    t12 = math.radians(initial_bearing(p1, p2))
    dxt_mt = math.asin(clamp(math.sin(d13) * math.sin(t13 - t12))) * radius
    out["cross_track_km"] = -dxt_mt
    ratio = math.cos(d13) / math.cos(dxt_mt / radius)
    dat = math.acos(clamp(ratio)) * radius
    if math.cos(t13 - t12) < 0:
        dat = -dat
    out["along_track_km"] = dat
    if abs(abs(dxt_mt) / radius - math.pi / 2) < 1e-12:
        out["degenerate"] = "point is exactly 90 degrees off the path: no unique foot"
        return out
    # Foot by the DIRECT formula (a different route from a 3D projection)
    if dat >= 0:
        foot = destination(p1, out["track_bearing"], dat, radius)
    else:
        foot = destination(p1, (out["track_bearing"] + 180.0) % 360.0, -dat, radius)
    out["foot"] = foot
    out["bearing_to_foot"] = initial_bearing(p3, foot)
    out["within_segment"] = (-1e-9 <= dat <= path_len + 1e-9)
    if out["within_segment"]:
        out["distance_to_segment_km"] = hav_km(p3, foot, radius)
    else:
        out["distance_to_segment_km"] = min(hav_km(p3, p1, radius), hav_km(p3, p2, radius))
    return out


# ── point in polygon (section C) ──────────────────────────────────────────
def frame_at(p):
    """Right-handed frame (north, cross(p_hat, north), p_hat) at `p`."""
    p_hat = xyz(p)
    la, lo = math.radians(p[0]), math.radians(p[1])
    north = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
    return p_hat, north, cross(p_hat, north)


def winding_number(points, p):
    """Winding number of the boundary around `p` by signed ray crossings.

    Each edge crossing the ray contributes +1 or -1 depending on whether the
    azimuth increases or decreases there — the planar winding rule lifted to
    the sphere. No antipodal blind spot, unlike the naive "sum of tangent
    angles" shortcut (P12 / P13 below are the discriminating cases).
    """
    pHat, e1, e2 = frame_at(p)
    verts = [xyz(v) for v in points]
    attempts = 0
    while True:
        if attempts >= 8:  # pragma: no cover - defensive, needs a contrived polygon
            raise RuntimeError("no usable ray direction found")
        bad = False
        for v in verts:
            lam = abs(math.atan2(dot(v, e2), dot(v, e1)))
            if lam < 1e-9 or math.pi - lam < 1e-9:
                bad = True
                break
        if not bad:
            break
        step = 0.37
        new_e1 = tuple(math.cos(step) * e1[i] + math.sin(step) * e2[i] for i in range(3))
        e1 = unit(new_e1)
        e2 = cross(pHat, e1)  # keep the frame right-handed
        attempts += 1
    n_ray = unit(cross(pHat, e1))

    total = 0
    for i, va in enumerate(verts):
        vb = verts[(i + 1) % len(verts)]

        def f(t, va=va, vb=vb):
            v = unit(tuple(math.cos(t) * va[k] + math.sin(t) * vb[k] for k in range(3)))
            return dot(v, n_ray)

        # bisect the arc [0, pi/2] for a sign change of the ray-circle height
        t_lo, t_hi = 0.0, math.pi / 2
        f_lo, f_hi = f(t_lo), f(t_hi)
        if f_lo * f_hi > 0:
            continue
        for _ in range(200):
            t_mid = (t_lo + t_hi) / 2
            f_mid = f(t_mid)
            if f_lo * f_mid <= 0:
                t_hi, f_hi = t_mid, f_mid
            else:
                t_lo, f_lo = t_mid, f_mid
        t_x = (t_lo + t_hi) / 2
        x = unit(tuple(math.cos(t_x) * va[k] + math.sin(t_x) * vb[k] for k in range(3)))
        if dot(x, e1) <= 0:
            continue  # crossing is on the opposite half of the great circle
        t_dir = unit(tuple(vb[k] - dot(vb, x) * x[k] for k in range(3)))
        slope = dot(t_dir, e2)
        if abs(slope) < 1e-12:  # pragma: no cover - defensive, needs a contrived polygon
            continue
        total += 1 if slope > 0 else -1
    return total


def on_boundary(points, p, tol_km=BOUNDARY_TOL_KM):
    """True when `p` sits on any edge (within the documented tolerance)."""
    n = len(points)
    for i in range(n):
        a, b = points[i], points[(i + 1) % n]
        if hav_km(p, a) <= tol_km or hav_km(p, b) <= tol_km:
            return True
        info = cross_track(a, b, p)
        if info["degenerate"] is not None:
            continue
        if abs(cast(float, info["cross_track_km"])) <= tol_km and cast(bool, info["within_segment"]):
            return True
    return False


def point_in_polygon(points, p):
    """Every quantity the geo_point_in_polygon tool reports, computed independently."""
    out: dict = {}
    left_area = polygon_left_area_km2(points)
    total = 4 * math.pi * R * R
    left_is_enclosed = left_area < 2 * math.pi * R * R
    boundary = on_boundary(points, p)
    # The winding is undefined (and not reported) for a point on the boundary —
    # which includes the case of a vertex sitting exactly on the query point.
    w = None if boundary else winding_number(points, p)
    enclosed = w is not None and w == (1 if left_is_enclosed else -1)
    out.update({
        "left_area_km2": left_area,
        "complement_km2": total - left_area,
        "left_is_enclosed": left_is_enclosed,
        "winding": w,
        "on_boundary": boundary,
        "inside_enclosed": enclosed and not boundary,
        "inside_left_region": (enclosed if left_is_enclosed else not enclosed) and not boundary,
        "region_area_km2": None if boundary else (left_area if (enclosed if left_is_enclosed else not enclosed) else total - left_area),
        "plane_orientation": plane_orientation(points),
    })
    return out


def plane_orientation(points):
    """Planar-proxy orientation (shoelace, +1 = CCW) — a second opinion only."""
    s = 0.0
    for i, p in enumerate(points):
        q = points[(i + 1) % len(points)]
        s += p[1] * q[0] - q[1] * p[0]  # lon = x, lat = y
    return 1 if s > 0 else -1


# ── spherical cap (section D, v0.4) ───────────────────────────────────────
def cap_angular_radius(radius_km, radius=R):
    """Angular radius in radians, capped at pi (beyond that the cap is the sphere)."""
    return min(radius_km / radius, math.pi)


def cap_area_km2(radius_km, radius=R):
    """Closed form: A = 2 pi R^2 (1 - cos d) — the solid angle of a cap is 2 pi (1 - cos d)."""
    return 2 * math.pi * radius * radius * (1 - math.cos(cap_angular_radius(radius_km, radius)))


def cap_boundary_km(radius_km, radius=R):
    """Closed form: C = 2 pi R sin d (a small circle of angular radius d)."""
    return 2 * math.pi * radius * math.sin(cap_angular_radius(radius_km, radius))


def cap_box(lat0, lon0, radius_km, radius=R):
    """The cap's latitude/longitude box, including the pole and antimeridian cases."""
    d = cap_angular_radius(radius_km, radius)
    ddeg = math.degrees(d)
    lat_max_raw, lat_min_raw = lat0 + ddeg, lat0 - ddeg
    includes_north = lat_max_raw >= 90.0 - 1e-12
    includes_south = lat_min_raw <= -90.0 + 1e-12
    covers_whole = radius_km >= math.pi * radius * (1 - 1e-12)
    out = {
        'minLat': max(-90.0, lat_min_raw),
        'maxLat': min(90.0, lat_max_raw),
        'includesNorthPole': includes_north,
        'includesSouthPole': includes_south,
        'coversWholeSphere': covers_whole,
    }
    if covers_whole or includes_north or includes_south:
        out.update({'minLon': -180.0, 'maxLon': 180.0, 'lonSpanDeg': 360.0,
                    'crossesAntimeridian': False, 'coversAllLongitudes': True})
        return out
    ratio = math.sin(d) / math.cos(math.radians(lat0))
    if abs(ratio) >= 1.0 - 1e-12:
        out.update({'minLon': -180.0, 'maxLon': 180.0, 'lonSpanDeg': 360.0,
                    'crossesAntimeridian': False, 'coversAllLongitudes': True})
        return out
    delta = math.degrees(math.asin(ratio))
    west, east = lon0 - delta, lon0 + delta
    crosses = west < -180.0 or east > 180.0
    out.update({
        'lonSpanDeg': 2 * delta,
        'crossesAntimeridian': crosses,
        'coversAllLongitudes': False,
        'minLon': normalize_lon(west) if crosses else west,
        'maxLon': normalize_lon(east) if crosses else east,
    })
    return out


def cap_point_verdict(lat0, lon0, radius_km, point, radius=R):
    """(distance km, inside, on boundary) for one query point."""
    distance = hav_km((lat0, lon0), point, radius)
    tol = BOUNDARY_TOL_RAD * radius
    on = abs(distance - radius_km) <= tol
    return distance, (not on and distance <= radius_km + tol), on


def cap_boundary_samples(lat0, lon0, radius_km, radius=R, count=7200):
    """Dense sample of the boundary circle, generated by the direct formula.

    The boundary is *defined* as the set of points at surface distance
    `radius_km` from the centre, so every sample can be tested against that
    definition instead of against the box formula it is meant to check.
    """
    d = cap_angular_radius(radius_km, radius)
    return [destination((lat0, lon0), 360.0 * k / count, d * radius, radius) for k in range(count)]


def cap_solid_angle_monte_carlo(lat0, lon0, radius_km, radius=R, samples=400000):
    """Quasi-Monte-Carlo (Fibonacci lattice) area of the cap — an independent method.

    Points are spread evenly over the unit sphere by the golden-angle lattice;
    the fraction with v . c >= cos d estimates the solid angle, which times
    R^2 is the area. Deterministic, unlike random sampling.
    """
    d = cap_angular_radius(radius_km, radius)
    centroid = xyz((lat0, lon0))
    golden = math.pi * (3.0 - math.sqrt(5.0))
    hits = 0
    for k in range(samples):
        z = 1.0 - 2.0 * (k + 0.5) / samples
        r_xy = math.sqrt(max(0.0, 1.0 - z * z))
        theta = golden * k
        v = (r_xy * math.cos(theta), r_xy * math.sin(theta), z)
        if dot(v, centroid) >= math.cos(d):
            hits += 1
    return radius * radius * 4.0 * math.pi * hits / samples


# ── multi-leg route totals (section D, v0.4) ──────────────────────────────
def path_legs(points, radius=R):
    """Per-leg (distance, bearing, cumulative) for an ordered waypoint list."""
    legs = []
    cumulative = 0.0
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        dist = hav_km(a, b, radius)
        cumulative += dist
        legs.append({
            'leg': i + 1,
            'fromIndex': i,
            'toIndex': i + 1,
            'distanceKm': dist,
            'cumulativeKm': cumulative,
            'initialBearing': None if dist < 1e-9 else initial_bearing(a, b),
            'compass': None if dist < 1e-9 else compass_name(initial_bearing(a, b)),
        })
    return legs


def path_totals(points, radius=R):
    """Everything the geo_path tool reports.

    The detour is the difference of the two *reported* totals (each quantised
    to 6 decimals, the same way the tool quantises them), not the raw
    subtraction — so a reader can verify the published detour against the
    published total and straight-line distance by hand (R68 口径).
    """
    legs = path_legs(points, radius)
    total = sum(leg['distanceKm'] for leg in legs)
    straight = hav_km(points[0], points[-1], radius)
    closure = hav_km(points[-1], points[0], radius)
    distances = [leg['distanceKm'] for leg in legs]
    reported_total = round(total, 6)
    reported_straight = round(straight, 6)
    detour = round(reported_total - reported_straight, 6)
    return {
        'legs': legs,
        'points': len(points),
        'totalKm': reported_total,
        'straightKm': reported_straight,
        'detourKm': detour,
        'detourPercent': None if reported_straight == 0 else round(detour / reported_straight * 100.0, 3),
        'rawTotalKm': total,
        'rawStraightKm': straight,
        'closureKm': closure,
        'closesLoop': closure < 1e-9,
        'maxLegKm': max(distances),
        'minLegKm': min(distances),
        'zeroLengthLegs': [leg['leg'] for leg in legs if leg['distanceKm'] < 1e-9],
    }


# ── section A: v0.1 anchors ───────────────────────────────────────────────
BEIJING = (39.9042, 116.4074)
SHANGHAI = (31.2304, 121.4737)
LONDON = (51.5074, -0.1278)
NEWYORK = (40.7128, -74.0060)

GC_CASES = [
    ('beijing-shanghai', BEIJING, SHANGHAI),
    ('london-newyork', LONDON, NEWYORK),
    ('equator-1deg', (0, 0), (0, 1)),
    ('equator-pole', (0, 0), (90, 0)),
    ('antipodal', (0, 0), (0, 180)),
    ('same-point', (37.775, -122.419), (37.775, -122.419)),
    ('sf-tokyo', (37.7749, -122.4194), (35.6762, 139.6503)),
    ('sydney-rio', (-33.8688, 151.2093), (-22.9068, -43.1729)),
    ('paris-berlin', (48.8566, 2.3522), (52.52, 13.405)),
]

DEST_CASES = [
    ((0, 0), 90, 1000),
    ((0, 0), 45, 1000),
    ((51.5074, -0.1278), 288.6, 5570.2),
    ((0, 0), 90, 20015.087),
]

COMPASS_CASES = [0, 11.24, 11.26, 33.75, 56.25, 78.76, 101.25, 123.76, 146.25, 168.76,
                 191.25, 213.76, 236.25, 258.76, 281.25, 303.76, 326.25, 348.76, 360, 361]


def print_section_a():
    print('=== A: v0.1 anchors (geo_distance / geo_bearing / geo_destination / coord_parse) ===')
    print('R =', R)
    print('pi/2 * R (equator->pole) =', math.pi / 2 * R)
    print('pi * R (antipodal) =', math.pi * R)
    for name, a, b in GC_CASES:
        d = hav_km(a, b)
        br, br2 = bearing_pair(a, b)
        print(f'{name}: dist={d:.6f} km ({d / 1.609344:.6f} mi, {d / 1.852:.6f} nmi) '
              f'init_bearing={br:.6f} final_bearing={br2:.6f} compass={compass_name(br)}')
        if name in ('beijing-shanghai', 'london-newyork', 'sf-tokyo', 'paris-berlin'):
            m = midpoint(a, b)
            print(f'  midpoint={m[0]:.6f}, {m[1]:.6f}')
    for p, brg, dist in DEST_CASES:
        dest = destination(p, brg, dist)
        check = hav_km(p, dest)
        print(f'dest from {p} brg={brg} d={dist}: lat={dest[0]:.6f} lon={dest[1]:.6f} check_dist={check:.6f}')
    print('DMS 37d46\'30"N =', 37 + 46 / 60 + 30 / 3600)
    print('DMS 122d25\'8.4"W =', -(122 + 25 / 60 + 8.4 / 3600))
    for b in COMPASS_CASES:
        print(f'compass({b}) -> {compass_name(b)}')

    # Unit and DMS constants the tests quote (mile/nmi factors, one degree of
    # arc, the lunar degree, and the DMS round-trips the coordinate parser is
    # tested against). Printed with six decimals so the literals in the test
    # files are visible verbatim.
    print(f'unit anchors: 1 mile = 1.609344 km, 1 nautical mile = 1.852 km')
    print(f'unit anchors: 1 degree of arc = {R * DEG:.6f} km = {R * DEG * 1000:.6f} m'
          f' = {R * DEG / 1.609344:.6f} mi = {R * DEG / 1.852:.6f} nmi')
    print(f'unit anchors: lunar degree (radius 1737.4 km) = {2 * math.pi * 1737.4 / 360.0:.6f} km')
    print('DMS anchors: 37d46m30s =', dms_to_decimal(37, 46, 30))
    print('DMS anchors: 122d25m8.4s =', -dms_to_decimal(122, 25, 8.4))
    print(f'DMS anchors: 12d0m30.6s = {dms_to_decimal(12, 0, 30.6):.6f}')
    print(f'DMS anchors: 39d54m15s = {dms_to_decimal(39, 54, 15):.6f}')
    print(f'DMS anchors: 116d23m27s = {dms_to_decimal(116, 23, 27):.6f}')


# ── section B: v0.2 anchors (rhumb / intersection / area) ─────────────────
RHUMB_CASES = [
    ('equator_quarter', (0, 0), (0, 90)),
    ('parallel_45', (45, 0), (45, 90)),
    ('general_10_10_20_30', (10, 10), (20, 30)),
    ('southward_10_0_-10_30', (10, 0), (-10, 30)),
    ('zero', (12.5, -77.2), (12.5, -77.2)),
]

PENTAGON_CW = [(0, 0), (2, 0), (2, 2), (1, 1), (0, 2)]


def section_b_data():
    out = {}
    out['rhumb'] = {}
    for key, a, b in RHUMB_CASES:
        d, brng = rhumb_closed(a, b)
        num_d, num_end = rhumb_numeric(a, b) if d > 0 else (0.0, list(a))
        out['rhumb'][key] = {
            'distance': round(d, 6),
            'bearing': round(brng, 6),
            'numericDistance': round(num_d, 6),
            'numericEndLat': round(num_end[0], 6),
            'numericEndLon': round(num_end[1], 6),
            'gc': round(hav_km(a, b), 6),
        }

    out['intersect'] = {}
    res, err = intersect_paths((0, 0), 90, (0, 90), 0)
    out['intersect']['eq_x_meridian'] = {
        'lat': round(res[0][0], 6), 'lon': round(res[0][1], 6),
        'd1': round(res[1], 6), 'd2': round(res[2], 6), 'err': err,
    }
    res, err = intersect_paths((0, 0), 0, (0, 90), 0)
    out['intersect']['meridians'] = {
        'lat': round(res[0][0], 6), 'lon': round(res[0][1], 6),
        'd1': round(res[1], 6), 'd2': round(res[2], 6), 'err': err,
    }
    res, err = intersect_paths((30, 60), 45, (30, 60), 150)
    out['intersect']['same_start'] = {
        'lat': round(res[0][0], 6), 'lon': round(res[0][1], 6),
        'd1': round(res[1], 6), 'd2': round(res[2], 6), 'err': err,
    }
    _, err = intersect_paths((0, 0), 90, (0, 40), 90)
    out['intersect']['coincident'] = {'err': err}
    _, err = intersect_paths((0, 0), 90, (0, 40), 270)
    out['intersect']['coincident_reverse'] = {'err': err}
    res, err = intersect_paths((10, 30), 60, (20, 40), 200)
    out['intersect']['general1'] = {
        'lat': round(res[0][0], 6), 'lon': round(res[0][1], 6),
        'd1': round(res[1], 6), 'd2': round(res[2], 6), 'err': err,
        'xt1': round(cross_track_gc_km((10, 30), res[0], 60), 6),
        'xt2': round(cross_track_gc_km((20, 40), res[0], 200), 6),
    }
    res, err = intersect_paths((50, 0), 60, (30, 45), 300)
    out['intersect']['general2'] = {
        'lat': round(res[0][0], 6), 'lon': round(res[0][1], 6),
        'd1': round(res[1], 6), 'd2': round(res[2], 6), 'err': err,
        'xt1': round(cross_track_gc_km((50, 0), res[0], 60), 6),
        'xt2': round(cross_track_gc_km((30, 45), res[0], 300), 6),
        'brng1': round(initial_bearing((50, 0), res[0]), 6),
        'brng2': round(initial_bearing((30, 45), res[0]), 6),
    }

    out['area'] = {}
    octant = [(0, 0), (0, 90), (90, 0)]
    area, perim, excess = polygon_area_girard(octant)
    out['area']['octant_ccw'] = {
        'area': round(area, 4), 'perimeter': round(perim, 4), 'excess': round(excess, 10),
    }
    area, perim, excess = polygon_area_girard([(0, 0), (90, 0), (0, 90)])
    out['area']['octant_cw'] = {
        'area': round(area, 4), 'perimeter': round(perim, 4), 'excess': round(excess, 10),
    }
    sq = [(0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)]
    area, perim, excess = polygon_area_girard(sq)
    out['area']['small_square'] = {
        'area': round(area, 6), 'perimeter': round(perim, 6),
        'planar': round(planar_shoelace_km2(sq, 0.05), 6),
    }
    area, perim, excess = polygon_area_girard(PENTAGON_CW)
    out['area']['reflex_pentagon_cw'] = {
        'area': round(area, 4), 'perimeter': round(perim, 4),
        'planar': round(planar_shoelace_km2(PENTAGON_CW, 1.0), 4),
        'complement': round(4 * math.pi * R * R - area, 4),
    }
    pent_ccw = [(0, 0), (0, 2), (1, 1), (2, 2), (2, 0)]
    area, perim, excess = polygon_area_girard(pent_ccw)
    out['area']['reflex_pentagon_ccw'] = {
        'area': round(area, 4), 'perimeter': round(perim, 4),
        'planar': round(planar_shoelace_km2(pent_ccw, 1.0), 4),
        'excess': round(excess, 10),
    }
    return out


def print_section_b():
    data = section_b_data()
    print('=== B: v0.2 anchors (geo_rhumb / geo_intersection / geo_area) ===')
    print(json.dumps(data, indent=2))
    print('intersect antipodes (the crossing mirrored through the centre, printed with six decimals):')
    for key, entry in data['intersect'].items():
        if 'lat' in entry:
            print(f'  {key}: crossing = {entry["lat"]:.6f}, {entry["lon"]:.6f}'
                  f' -> antipode = {-entry["lat"]:.6f}, {normalize_lon(entry["lon"] + 180.0):.6f}')


# ── section C: v0.3 anchors (cross-track / point in polygon) ──────────────
OCTANT_CCW = [(0, 0), (0, 90), (90, 0)]
OCTANT_CW = [(0, 0), (90, 0), (0, 90)]
SMALL_SQUARE_CW = [(0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)]
ANTIMERIDIAN_BOX = [(10, 170), (10, -170), (-10, -170), (-10, 170)]
TINY_ANTIPODAL_BOX = [(0.1, 179.9), (0.1, -179.9), (-0.1, -179.9), (-0.1, 179.9)]

CROSS_CASES = [
    ("C1", (0, 0), (0, 10), (1, 5), "equator path, point to the north (left)", R),
    ("C2", (0, 0), (0, 10), (-1, 5), "equator path, point to the south (right)", R),
    ("C3", (0, 0), (0, 10), (1, -5), "foot falls behind p1", R),
    ("C4", (0, 0), (0, 10), (1, 25), "foot falls beyond p2", R),
    ("C5", (39.9042, 116.4074), (31.2304, 121.4737), (30.0, 120.0), "oblique path", R),
    ("C6", (0, 0), (50, 0), (20, 10), "meridian path", R),
    ("C7", (0, 0), (0, 10), (0, 0), "query point equals p1", R),
    ("C8", (0, 0), (0, 10), (90, 0), "point exactly 90 degrees off the path", R),
    ("C9", (0, 0), (0, 10), (1, 5), "same as C1 but on a moon-sized sphere (radiusKm 1737.4)", 1737.4),
]

POLY_CASES = [
    ("P1", OCTANT_CCW, (45, 45), "octant triangle, point inside"),
    ("P2", OCTANT_CCW, (45, -45), "octant triangle, point outside"),
    ("P3", OCTANT_CW, (45, 45), "octant triangle wound the other way, point inside it"),
    ("P4", OCTANT_CW, (45, -45), "octant triangle wound the other way, point in the complement"),
    ("P5", SMALL_SQUARE_CW, (0.05, 0.05), "small square (clockwise), point inside it"),
    ("P6", SMALL_SQUARE_CW, (1, 1), "small square (clockwise), point far outside"),
    ("P7", OCTANT_CCW, (0, 45), "point exactly on the equator edge"),
    ("P8", OCTANT_CCW, (0, 0), "point exactly on a vertex"),
    ("P9", PENTAGON_CW, (0.5, 0.5), "concave pentagon, point inside the body"),
    ("P10", PENTAGON_CW, (0.5, 1.8), "concave pentagon, point in the notch"),
    ("P11", ANTIMERIDIAN_BOX, (0, 180), "20-degree strip straddling the antimeridian, point inside"),
    ("P12", ANTIMERIDIAN_BOX, (0, 0), "20-degree strip straddling the antimeridian, far-away point"),
    ("P13", TINY_ANTIPODAL_BOX, (0, 0), "0.2-degree box, point at its exact antipode (the trap the naive angle-sum method gets wrong)"),
    ("P14", TINY_ANTIPODAL_BOX, (0, 180), "0.2-degree box, point in its middle"),
]


def fmt(x, digits=6):
    if x is None:
        return "None"
    return f"{round(x, digits) + 0.0:.{digits}f}"


def print_section_c():
    print('=== C: v0.3 anchors (geo_cross_track / geo_point_in_polygon) ===')
    print(f"radius = {R} km | boundary tolerance = {BOUNDARY_TOL_KM:.9f} km ({BOUNDARY_TOL_RAD:g} rad)")
    print()
    print("--- cross-track / along-track (src/path.ts) ---")
    for tag, p1, p2, p3, note, radius in CROSS_CASES:
        info = cross_track(p1, p2, p3, radius)
        print(f"\n[{tag}] {note}")
        print(f"  p1={p1} p2={p2} p3={p3} radius={radius}")
        if info["degenerate"] is not None:
            print(f"  degenerate: {info['degenerate']}")
            if "cross_track_km" in info:
                print(f"  cross_track_km={fmt(info['cross_track_km'])} along_track_km={fmt(info['along_track_km'])}")
            continue
        print(f"  path_length_km      = {fmt(info['path_length_km'])}")
        print(f"  track_bearing       = {fmt(info['track_bearing'])}")
        print(f"  cross_track_km      = {fmt(info['cross_track_km'])}")
        print(f"  along_track_km      = {fmt(info['along_track_km'])}")
        foot = cast(tuple, info["foot"])
        print(f"  foot                = {fmt(foot[0])}, {fmt(foot[1])}")
        print(f"  bearing_to_foot     = {fmt(info['bearing_to_foot'])}")
        print(f"  within_segment      = {info['within_segment']}")
        print(f"  distance_to_segment = {fmt(info['distance_to_segment_km'])}")

    print("\n--- point in polygon (src/region.ts) ---")
    for tag, pts, p, note in POLY_CASES:
        info = point_in_polygon(pts, p)
        print(f"\n[{tag}] {note}")
        print(f"  vertices={len(pts)} point={p} plane_orientation={info['plane_orientation']}")
        print(f"  left_area_km2       = {fmt(info['left_area_km2'])}")
        print(f"  complement_km2      = {fmt(info['complement_km2'])}")
        print(f"  left_is_enclosed    = {info['left_is_enclosed']}")
        print(f"  winding             = {info['winding']}")
        print(f"  on_boundary         = {info['on_boundary']}")
        print(f"  inside_enclosed     = {info['inside_enclosed']}")
        print(f"  inside_left_region  = {info['inside_left_region']}")
        print(f"  region_area_km2     = {fmt(info['region_area_km2'])}")


# ── section D: v0.4 anchors (path totals / spherical cap) ─────────────────
PATH_CASES = [
    ('route1', [(0, 0), (0, 10), (10, 10), (10, 20)], 'three-leg route through (0,10) and (10,10)'),
    ('route2', [(39.9042, 116.4074), (31.2304, 121.4737), (22.3193, 114.1694)], 'Beijing -> Shanghai -> Hong Kong'),
    ('route3', [(0, 0), (0, 10), (5, 20), (0, 30)], 'zig-zag with a turn'),
    ('route4', [(51.5074, -0.1278), (48.8566, 2.3522), (41.9028, 12.4964)], 'London -> Paris -> Rome'),
    ('route5', [(0, 0), (0, 0), (0, 10)], 'second waypoint duplicates the first (zero-length leg)'),
    ('route6', [(0, 0), (0, 10), (0, 20), (0, 0)], 'closed loop along the equator'),
    ('route7', [(0, 0), (0, 180)], 'antipodal two-point path (detour is exactly zero)'),
    ('route8', [(10, 10), (10, 10)], 'two identical waypoints: one zero-length leg'),
]

# Definitional radii: never a hand-typed rounded decimal (the value of pi/2 * R
# is 10007.557221017962, not the 10007.557220364266 one might guess).
QUARTER_CIRCUMFERENCE = math.pi / 2 * R
HALF_CIRCUMFERENCE = math.pi * R

CAP_CASES = [
    ('cap1', (0, 0), 1000.0, None, '1000 km cap on the equator'),
    ('cap2', (0, 0), QUARTER_CIRCUMFERENCE, None, 'a quarter of the circumference: hemisphere, great-circle boundary'),
    ('cap3', (80, 10), 1200.0, None, 'cap reaching the north pole -> every longitude'),
    ('cap4', (0, 179.5), 100.0, None, 'cap straddling the antimeridian'),
    ('cap5', (39.9042, 116.4074), 300.0, (40.5, 117.0), 'Beijing 300 km cap with a query point inside'),
    ('cap6', (39.9042, 116.4074), 300.0, (35.0, 110.0), 'same cap, query point outside'),
    ('cap7', (0, 0), 300.0, None, 'query point placed exactly 300 km east by the direct formula'),
    ('cap8', (0, 0), HALF_CIRCUMFERENCE, None, 'half the circumference: the whole sphere'),
    ('cap9', (0, 0), 1.0, None, 'planar-limit cap: 1 km radius'),
]

# Exactly 300 km due east of the origin, by the direct formula: the probe the
# on-boundary assertions use. Its coordinates are printed below; the tests
# rebuild it with the plugin's own geo_destination rather than quoting a
# rounded literal (rounding to 1e-6 degree is ~11 cm of arc, which is far
# larger than the 6 mm boundary tolerance).
BOUNDARY_PROBE = destination((0.0, 0.0), 90.0, 300.0)


def print_section_d():
    print('=== D: v0.4 anchors (geo_path / geo_circle) ===')
    print()
    print('--- multi-leg route totals (src/path.ts) ---')
    for tag, points, note in PATH_CASES:
        info = path_totals(points)
        print(f"\n[{tag}] {note}")
        print(f"  points={info['points']} total_km={fmt(info['totalKm'])} straight_km={fmt(info['straightKm'])}")
        print(f"  raw_total_km={fmt(info['rawTotalKm'])} raw_straight_km={fmt(info['rawStraightKm'])}")
        print(f"  detour_km={fmt(info['detourKm'])} "
              f"detour_percent={'None' if info['detourPercent'] is None else fmt(info['detourPercent'], 3)}")
        print(f"  closure_km={fmt(info['closureKm'])} closes_loop={info['closesLoop']} "
              f"max_leg_km={fmt(info['maxLegKm'])} min_leg_km={fmt(info['minLegKm'])}")
        print(f"  zero_length_legs={info['zeroLengthLegs']}")
        for leg in info['legs']:
            bearing = 'None' if leg['initialBearing'] is None else fmt(leg['initialBearing'])
            compass = 'None' if leg['compass'] is None else leg['compass']
            print(f"  leg {leg['leg']}: {leg['fromIndex']}->{leg['toIndex']} "
                  f"distance_km={fmt(leg['distanceKm'])} cumulative_km={fmt(leg['cumulativeKm'])} "
                  f"bearing={bearing} compass={compass}")

    print()
    print('--- spherical cap (src/cap.ts) ---')
    for tag, center, radius_km, point, note in CAP_CASES:
        box = cap_box(center[0], center[1], radius_km)
        print(f"\n[{tag}] {note}")
        print(f"  centre={center} radius_km={radius_km}")
        print(f"  angular_radius_deg={fmt(math.degrees(cap_angular_radius(radius_km)))}")
        print(f"  area_km2={fmt(cap_area_km2(radius_km))} "
              f"surface_fraction={fmt(cap_area_km2(radius_km) / (4 * math.pi * R * R), 10)}")
        print(f"  boundary_km={fmt(cap_boundary_km(radius_km))} "
              f"boundary_is_great_circle={abs(cap_angular_radius(radius_km) - math.pi / 2) < 1e-12}")
        print(f"  min_lat={fmt(box['minLat'])} max_lat={fmt(box['maxLat'])}")
        print(f"  min_lon={fmt(box['minLon'])} max_lon={fmt(box['maxLon'])} lon_span_deg={fmt(box['lonSpanDeg'])}")
        print(f"  crosses_antimeridian={box['crossesAntimeridian']} covers_all_longitudes={box['coversAllLongitudes']} "
              f"includes_north_pole={box['includesNorthPole']} includes_south_pole={box['includesSouthPole']} "
              f"covers_whole_sphere={box['coversWholeSphere']}")
        if point is not None:
            distance, inside, on = cap_point_verdict(center[0], center[1], radius_km, point)
            print(f"  query_point={point} distance_km={fmt(distance)} contains_point={inside} on_boundary={on}")

    probe_distance, probe_inside, probe_on = cap_point_verdict(0.0, 0.0, 300.0, BOUNDARY_PROBE)
    print("\n[cap7 probe] exactly 300 km east of the origin, by the direct formula")
    print(f"  probe_lat={fmt(BOUNDARY_PROBE[0], 9)} probe_lon={fmt(BOUNDARY_PROBE[1], 9)}")
    print(f"  distance_km={fmt(probe_distance, 9)} contains_point={probe_inside} on_boundary={probe_on}")


# ── self-check: definitional rulers and public values ─────────────────────
def self_check():
    """Assert the oracle against definitional identities, public values and
    a *second independent method*. Only failures are printed; rc=1 on any."""
    failures = []

    def check(name, ok, detail=''):
        if not ok:
            failures.append(f'{name}{" — " + detail if detail else ""}')

    def close(name, got, want, tol):
        check(name, abs(got - want) <= tol, f'got {got!r}, want {want!r} (tol {tol})')

    total_area = 4 * math.pi * R * R

    # 1. Definitional identities for the cap ---------------------------------
    close('cap: hemisphere area = 2 pi R^2', cap_area_km2(math.pi * R / 2), total_area / 2, 1e-6)
    close('cap: hemisphere boundary = 2 pi R', cap_boundary_km(math.pi * R / 2), 2 * math.pi * R, 1e-9)
    close('cap: whole sphere area = 4 pi R^2', cap_area_km2(math.pi * R), total_area, 1e-6)
    close('cap: whole sphere boundary vanishes', cap_boundary_km(math.pi * R), 0.0, 1e-9)
    check('cap: hemisphere boundary is a great circle',
          abs(cap_angular_radius(math.pi * R / 2) - math.pi / 2) < 1e-12)
    close('cap: the definitional quarter-circumference radius is exactly pi/2 in radians',
          cap_angular_radius(QUARTER_CIRCUMFERENCE), math.pi / 2, 0.0)
    check('cap: the definitional half-circumference radius covers the whole sphere',
          cap_box(0.0, 0.0, HALF_CIRCUMFERENCE)['coversWholeSphere'])
    # planar limit: a tiny cap is a disc, A = pi r^2 + O(r^4 / R^2)
    small = cap_area_km2(1.0)
    check('cap: 1 km cap is within 1e-5 of the planar disc area',
          abs(small - math.pi) / math.pi < 1e-5, f'relative error {abs(small - math.pi) / math.pi:g}')
    # 1 degree of arc at the equator
    close('haversine: 1 degree of arc at the equator', hav_km((0, 0), (0, 1)), R * DEG, 1e-9)
    close('haversine: equator to pole = pi R / 2', hav_km((0, 0), (90, 0)), math.pi * R / 2, 1e-9)

    # 2. Independent method: quasi-Monte-Carlo solid angle --------------------
    for radius_km in (1000.0, 4000.0, math.pi * R / 2):
        exact = cap_area_km2(radius_km)
        mc = cap_solid_angle_monte_carlo(0.0, 0.0, radius_km, samples=200000)
        check(f'cap: solid-angle Monte Carlo agrees for r={radius_km:.0f} km',
              abs(mc - exact) / exact < 5e-3, f'exact {exact:.3f} vs MC {mc:.3f}')

    # 3. The boundary really is the set of points at distance d ---------------
    for center, radius_km in [((0.0, 0.0), 1000.0), ((80.0, 10.0), 1200.0),
                              ((0.0, 179.5), 100.0), ((39.9042, 116.4074), 300.0)]:
        d = cap_angular_radius(radius_km)
        samples = cap_boundary_samples(center[0], center[1], radius_km, count=1800)
        worst = max(abs(hav_km(center, s) - d * R) for s in samples)
        check(f'cap: sampled boundary points are exactly d away ({center}, {radius_km:.0f} km)',
              worst < 1e-6, f'worst deviation {worst:g} km')
        box = cap_box(center[0], center[1], radius_km)
        if box['coversAllLongitudes']:
            # A cap that reaches a pole contains it: the latitude box is clamped
            # to the pole itself, and the *boundary* never reaches it (the
            # samples stop 90 - d short), so the box is checked against the
            # pole, not against the sampled boundary extremes.
            pole = (90.0, center[1]) if box['includesNorthPole'] else (-90.0, center[1])
            _, inside, _ = cap_point_verdict(center[0], center[1], radius_km, pole)
            check(f'cap: the enclosed pole is inside the cap ({center}, {radius_km:.0f} km)',
                  inside and hav_km(center, pole) <= radius_km + 1e-9,
                  f'distance to pole {hav_km(center, pole):.6f} km vs radius {radius_km:.0f} km')
            check(f'cap: the latitude box is clamped to the contained pole ({center}, {radius_km:.0f} km)',
                  (box['maxLat'] == 90.0) if box['includesNorthPole'] else (box['minLat'] == -90.0),
                  f'box [{box["minLat"]:.6f}, {box["maxLat"]:.6f}]')
            continue
        lat_lo = min(s[0] for s in samples)
        lat_hi = max(s[0] for s in samples)
        check(f'cap: sampled latitude extremes match the box ({center}, {radius_km:.0f} km)',
              abs(lat_lo - box['minLat']) < 1e-3 and abs(lat_hi - box['maxLat']) < 1e-3,
              f'sampled [{lat_lo:.6f}, {lat_hi:.6f}] vs box [{box["minLat"]:.6f}, {box["maxLat"]:.6f}]')
        lon_delta = max(abs(normalize_lon(s[1] - center[1])) for s in samples)
        check(f'cap: sampled longitude span matches the box ({center}, {radius_km:.0f} km)',
              abs(lon_delta - box['lonSpanDeg'] / 2) < 5e-3,
              f'sampled half-span {lon_delta:.6f} vs box {box["lonSpanDeg"] / 2:.6f}')

    # 4. Containment is the distance test, not a box test --------------------
    distance, inside, _ = cap_point_verdict(39.9042, 116.4074, 300.0, (40.5, 117.0))
    check('cap: containment agrees with the distance test', inside and distance < 300.0)
    distance, inside, _ = cap_point_verdict(39.9042, 116.4074, 300.0, (35.0, 110.0))
    check('cap: a far point is outside', not inside and distance > 300.0)
    # The probe is placed by the direct formula, so the two inverse operations
    # (direct problem / haversine) have to agree to well inside the tolerance.
    probe_distance, probe_inside, probe_on = cap_point_verdict(0.0, 0.0, 300.0, BOUNDARY_PROBE)
    check('cap: a point placed exactly 300 km away is reported as on the boundary',
          probe_on and not probe_inside,
          f'distance {probe_distance:.9f} km vs radius 300 km (tolerance {BOUNDARY_TOL_KM * 1000:.3f} m)')

    # 5. Route invariants ----------------------------------------------------
    for tag, points, _ in PATH_CASES:
        info = path_totals(points)
        leg_sum = sum(leg['distanceKm'] for leg in info['legs'])
        close(f'path[{tag}]: total equals the sum of its legs', info['rawTotalKm'], leg_sum, 1e-12)
        close(f'path[{tag}]: the reported total is the quantised leg sum',
              info['totalKm'], round(leg_sum, 6), 0.0)
        check(f'path[{tag}]: total >= straight line (triangle inequality)',
              info['rawTotalKm'] >= info['rawStraightKm'] - 1e-9,
              f'{info["rawTotalKm"]} vs {info["rawStraightKm"]}')
        check(f'path[{tag}]: detour is never negative', info['detourKm'] >= 0.0)
        close(f'path[{tag}]: the reported detour is the difference of the reported totals',
              info['detourKm'], round(info['totalKm'] - info['straightKm'], 6), 0.0)
        check(f'path[{tag}]: closure is the distance from the last waypoint back to the first',
              abs(info['closureKm'] - hav_km(points[-1], points[0])) < 1e-12)
    two_point = path_totals([(0, 0), (0, 10)])
    close('path: a two-point route has zero detour', two_point['detourKm'], 0.0, 1e-12)
    check('path: a two-point route reports no zero-length legs', two_point['zeroLengthLegs'] == [])
    dup = path_totals([(0, 0), (0, 0), (0, 10)])
    check('path: identical consecutive waypoints are reported as a zero-length leg',
          dup['zeroLengthLegs'] == [1] and dup['legs'][0]['initialBearing'] is None,
          f'zeroLengthLegs={dup["zeroLengthLegs"]}')
    loop = path_totals([(0, 0), (0, 10), (0, 20), (0, 0)])
    check('path: a closed loop reports closesLoop', loop['closesLoop'] and loop['straightKm'] == 0.0)
    check('path: a closed loop has no meaningful detour percentage', loop['detourPercent'] is None)
    equi = path_totals([(0, 0), (0, 10), (0, 20), (0, 30)])
    maybe = path_totals([(0, 0), (0, 10), (5, 20), (0, 30)])
    check('path: an equatorial straight run has zero detour', equi['detourKm'] < 1e-9)
    check('path: a detour route reports a positive detour', maybe['detourKm'] > 1.0)

    # 6. Cross-formulation agreement (two derivations of the same area) -------
    for tag, pts in [('octant_ccw', OCTANT_CCW), ('pentagon_cw', PENTAGON_CW),
                     ('antimeridian_box', ANTIMERIDIAN_BOX)]:
        a1 = polygon_left_area_km2(pts)
        a2 = polygon_area_girard(pts)[0]
        close(f'area[{tag}]: the two independent derivations agree', a1, a2, 1e-6)
    close('area: the octant triangle is exactly pi/2 R^2',
          polygon_left_area_km2(OCTANT_CCW), math.pi / 2 * R * R, 1e-6)
    close('area: the octant complement is 7 pi/2 R^2',
          polygon_left_area_km2(OCTANT_CW), 7 * math.pi / 2 * R * R, 1e-6)

    # 7. Behavioural invariants already covered by the v0.3 sections ---------
    on_path = cross_track((0, 0), (0, 10), (0, 5))
    close('cross-track: a point on the path has zero cross-track', on_path['cross_track_km'], 0.0, 1e-9)
    close('cross-track: a point on the path has zero distance to it', on_path['distance_to_segment_km'], 0.0, 1e-9)
    close('cross-track: 1 degree north of the equator path is 1 degree of arc',
          cross_track((0, 0), (0, 10), (1, 5))['cross_track_km'], R * DEG, 1e-6)
    rhumb_d, _ = rhumb_closed((45, 0), (45, 90))
    check('rhumb: the 45th parallel detour exceeds the great circle',
          rhumb_d > hav_km((45, 0), (45, 90)) + 100.0)

    if failures:
        print('SELF-CHECK FAILED:', file=sys.stderr)
        for line in failures:
            print(f'  ✗ {line}', file=sys.stderr)
        return 1
    print('self-check: all definitional rulers, public values and independent methods agree')
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description='dsh-geodesy anchor oracle')
    parser.add_argument('--check', action='store_true',
                        help='verify the oracle itself against definitional rulers and public values')
    args = parser.parse_args(argv)
    if args.check:
        return self_check()
    print_section_a()
    print()
    print_section_b()
    print()
    print_section_c()
    print()
    print_section_d()
    return 0


if __name__ == '__main__':
    sys.exit(main())
