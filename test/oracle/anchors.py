#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Independent oracle for the dsh-geodesy v0.3.0 anchors.

Why this file is committed: every numeric expectation in the TypeScript tests
added for v0.3.0 (`test/path.test.ts`, `test/region.test.ts`) must come from an
*independent* implementation — not from the code under test and not from mental
arithmetic (the "guessed expectation" failure mode, R19/R21/R27/R30/R46 in the
pipeline log). Running this script reproduces, value by value, the anchors
quoted in those two files.

The two algorithms here are deliberately different from the TypeScript ones:

* cross-track / along-track: classical *scalar* spherical trigonometry
  (Movable Type Scripts derivation — delta13, theta13, theta12), while
  `src/path.ts` works in 3D unit vectors. The foot of the perpendicular is
  produced here with the *direct* (destination) formula, not by projection.
* point in polygon: rotate the sphere so the query point becomes the north
  pole, then sum the wrapped longitude differences (the classic "sum of
  longitudes" winding test), while `src/region.ts` sums tangent-plane angles
  at the query point.

Sign conventions (documented once, used everywhere):
  crossTrackKm > 0  <=>  the point lies to the LEFT of the path direction,
  where "left" is the right-hand-rule side of p1 -> p2 as seen from outside
  the sphere. The Movable Type formula returns the opposite sign, hence the
  explicit negation in `cross_track()`.
  alongTrackKm > 0  <=>  the perpendicular foot lies ahead of p1.

Legacy v0.1/v0.2 anchors (great-circle, rhumb, intersection, area) still live
in ../anchors.py and ../anchors_v2.py; they predate the `test/oracle/`
convention and are intentionally left in place.

Usage: python3 test/oracle/anchors.py
"""

import math
from typing import cast

R = 6371.0088  # IUGG mean Earth radius, km
DEG = math.pi / 180.0
BOUNDARY_TOL_RAD = 1e-9  # "on the boundary" tolerance: ~6 mm of arc
BOUNDARY_TOL_KM = BOUNDARY_TOL_RAD * R


# ── generic helpers (independent of src/) ─────────────────────────────────
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


def clamp(x, lo=-1.0, hi=1.0):
    return max(lo, min(hi, x))


# ── cross-track / along-track (scalar closed forms) ───────────────────────
def cross_track(p1, p2, p3, radius=R):
    """Cross-track / along-track data for p3 relative to the path p1 -> p2.

    Returns a dict; `degenerate` explains why the perpendicular foot is not
    unique when the scalar formula has no usable solution.
    """
    out: dict[str, object] = {"degenerate": None}
    path_len = hav_km(p1, p2, radius)
    out["path_length_km"] = path_len
    out["track_bearing"] = initial_bearing(p1, p2)
    if path_len < 1e-9:
        out["degenerate"] = "coincident path endpoints"
        return out

    d13 = hav_km(p1, p3, radius) / radius    # angular distance, radians
    t13 = math.radians(initial_bearing(p1, p3))
    t12 = math.radians(initial_bearing(p1, p2))
    # Movable Type Scripts cross-track formula (positive to the RIGHT of the
    # track); negate for our left-positive convention.
    dxt_mt = math.asin(clamp(math.sin(d13) * math.sin(t13 - t12))) * radius
    out["cross_track_km"] = -dxt_mt
    # Along-track: magnitude from the closed form, sign from cos(theta13-theta12)
    ratio = math.cos(d13) / math.cos(dxt_mt / radius)
    dat = math.acos(clamp(ratio)) * radius
    if math.cos(t13 - t12) < 0:
        dat = -dat
    out["along_track_km"] = dat
    if abs(abs(dxt_mt) / radius - math.pi / 2) < 1e-12:
        out["degenerate"] = "point is exactly 90 degrees off the path: no unique foot"
        return out
    # Foot by the DIRECT formula (different route from a 3D projection)
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


# ── spherical polygon area / orientation (Girard, independent) ────────────
def _xyz(p):
    la, lo = math.radians(p[0]), math.radians(p[1])
    return (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _unit(v):
    n = math.sqrt(_dot(v, v))
    return (v[0] / n, v[1] / n, v[2] / n)


def _tangent_toward(v, t):
    d = _dot(t, v)
    raw = (t[0] - d * v[0], t[1] - d * v[1], t[2] - d * v[2])
    n = math.sqrt(_dot(raw, raw))
    if n < 1e-9:
        return None
    return (raw[0] / n, raw[1] / n, raw[2] / n)


def polygon_left_area_km2(pts):
    """Area of the region LEFT of the directed edges (spherical excess)."""
    n = len(pts)
    verts = [_xyz(p) for p in pts]
    total = 0.0
    for i in range(n):
        v = verts[i]
        w = _tangent_toward(v, verts[(i - 1) % n])
        u = _tangent_toward(v, verts[(i + 1) % n])
        a = math.atan2(_dot(v, _cross(u, w)), _dot(w, u))
        total += a if a >= 0 else a + 2 * math.pi
    excess = total - (n - 2) * math.pi
    return R * R * excess


def plane_orientation(pts):
    """Planar-proxy orientation of the vertex list (shoelace, +1 = CCW).

    Only used as a second opinion on the winding of the test polygons; the
    authoritative criterion is the sign of the spherical excess above.
    """
    s = 0.0
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        s += p[1] * q[0] - q[1] * p[0]  # lon = x, lat = y
    return 1 if s > 0 else -1


# ── point in polygon (rotate to the pole, signed ray crossings) ───────────
def frame_at(p):
    """Right-handed frame (north, cross(p_hat, north), p_hat) at `p`.

    The ray used for the crossing test points along `north` (rotated if a
    vertex sits exactly on the ray's great circle) — the same geometry the
    TypeScript code builds, but the crossing itself is found here by BISECTION
    on the arc parameter, not by a closed-form cross product.
    """
    p_hat = _xyz(p)
    la, lo = math.radians(p[0]), math.radians(p[1])
    north = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
    return p_hat, north, _cross(p_hat, north)


def winding_number(pts, p):
    """Winding number of the boundary around `p` by signed ray crossings.

    A ray is the half great circle from `p` along the frame's first axis. Each
    edge crossing the ray contributes +1 or -1 depending on whether the
    azimuth increases or decreases there (the standard planar winding rule,
    lifted to the sphere). This has no antipodal blind spot — unlike the
    naive "sum of tangent-plane angles" method, which reports a wrong answer
    for query points near the antipode of the polygon (P12 / P13 below).
    """
    pHat, e1, e2 = frame_at(p)
    verts = [_xyz(v) for v in pts]
    attempts = 0
    while True:
        if attempts >= 8:  # pragma: no cover - defensive, needs a contrived polygon
            raise RuntimeError("no usable ray direction found")
        bad = False
        for v in verts:
            lam = abs(math.atan2(_dot(v, e2), _dot(v, e1)))
            if lam < 1e-9 or math.pi - lam < 1e-9:
                bad = True
                break
        if not bad:
            break
        step = 0.37
        new_e1 = tuple(math.cos(step) * e1[i] + math.sin(step) * e2[i] for i in range(3))
        e1 = _unit(new_e1)
        e2 = _cross(pHat, e1)  # keep the frame right-handed
        attempts += 1
    n_ray = _unit(_cross(pHat, e1))

    total = 0
    for i, va in enumerate(verts):
        vb = verts[(i + 1) % len(verts)]

        def f(t, va=va, vb=vb):
            v = _unit(tuple(math.cos(t) * va[k] + math.sin(t) * vb[k] for k in range(3)))
            return _dot(v, n_ray)

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
        x = _unit(tuple(math.cos(t_x) * va[k] + math.sin(t_x) * vb[k] for k in range(3)))
        if _dot(x, e1) <= 0:
            continue  # crossing is on the opposite half of the great circle
        # traversal direction at the crossing, and the sign of the azimuth change
        t_dir = _unit(tuple(vb[k] - _dot(vb, x) * x[k] for k in range(3)))
        slope = _dot(t_dir, e2)
        if abs(slope) < 1e-12:  # pragma: no cover - defensive, needs a contrived polygon
            continue
        total += 1 if slope > 0 else -1
    return total


def on_boundary(pts, p, tol_km=BOUNDARY_TOL_KM):
    """True when `p` sits on any edge (within the documented tolerance)."""
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        if hav_km(p, a) <= tol_km or hav_km(p, b) <= tol_km:
            return True
        info = cross_track(a, b, p)
        if info["degenerate"] is not None:
            continue
        if abs(cast(float, info["cross_track_km"])) <= tol_km and cast(bool, info["within_segment"]):
            return True
    return False


def point_in_polygon(pts, p):
    """Every quantity the geo_point_in_polygon tool reports, computed independently."""
    out: dict[str, object] = {}
    left_area = polygon_left_area_km2(pts)
    total = 4 * math.pi * R * R
    left_is_enclosed = left_area < 2 * math.pi * R * R
    boundary = on_boundary(pts, p)
    # The winding is undefined (and not reported) for a point on the boundary —
    # which includes the case of a vertex sitting exactly on the query point.
    w = None if boundary else winding_number(pts, p)
    # A boundary on a sphere has two sides: the signed crossing sum must be
    # calibrated against which region the polygon encloses (+1 when the
    # enclosed region is the left one, -1 when it is the right one).
    enclosed = w is not None and w == (1 if left_is_enclosed else -1)
    inside_enclosed = enclosed and not boundary
    inside_left = (enclosed if left_is_enclosed else not enclosed) and not boundary
    out.update({
        "left_area_km2": left_area,
        "complement_km2": total - left_area,
        "left_is_enclosed": left_is_enclosed,
        "winding": w,
        "on_boundary": boundary,
        "inside_enclosed": inside_enclosed,
        "inside_left_region": inside_left,
        "region_area_km2": None if boundary else (left_area if inside_left else total - left_area),
        "plane_orientation": plane_orientation(pts),
    })
    return out


# ── the anchors quoted by the TypeScript tests ───────────────────────────
OCTANT_CCW = [(0, 0), (0, 90), (90, 0)]
OCTANT_CW = [(0, 0), (90, 0), (0, 90)]
SMALL_SQUARE_CW = [(0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)]
PENTAGON_CW = [(0, 0), (2, 0), (2, 2), (1, 1), (0, 2)]

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

ANTIMERIDIAN_BOX = [(10, 170), (10, -170), (-10, -170), (-10, 170)]
TINY_ANTIPODAL_BOX = [(0.1, 179.9), (0.1, -179.9), (-0.1, -179.9), (-0.1, 179.9)]

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


def main():
    print(f"radius = {R} km | boundary tolerance = {BOUNDARY_TOL_KM:.9f} km ({BOUNDARY_TOL_RAD:g} rad)")
    print()
    print("=== cross-track / along-track (src/path.ts) ===")
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

    print("\n\n=== point in polygon (src/region.ts) ===")
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


if __name__ == "__main__":
    main()
