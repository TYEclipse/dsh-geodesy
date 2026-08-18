#!/usr/bin/env python3
"""Independent anchor computation for dsh-geodesy test values.
Closed-form geodesic math, independent of the TypeScript implementation."""
import math

R = 6371.0088  # IUGG mean Earth radius, km


def hav(a, b):
    la1, lo1 = math.radians(a[0]), math.radians(a[1])
    la2, lo2 = math.radians(b[0]), math.radians(b[1])
    dla = la2 - la1
    dlo = lo2 - lo1
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    h = min(1.0, h)
    return 2 * R * math.asin(math.sqrt(h))


def init_bearing(a, b):
    la1, lo1 = math.radians(a[0]), math.radians(a[1])
    la2, lo2 = math.radians(b[0]), math.radians(b[1])
    dlo = lo2 - lo1
    y = math.sin(dlo) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dlo)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def bearing(a, b):
    # final bearing = reverse of the initial bearing from b to a (Movable Type)
    br = init_bearing(a, b)
    br2 = (init_bearing(b, a) + 180) % 360
    return br, br2


def destination(p, brg, dist_km):
    la1, lo1 = math.radians(p[0]), math.radians(p[1])
    th = math.radians(brg)
    d = dist_km / R
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(th))
    lo2 = lo1 + math.atan2(math.sin(th) * math.sin(d) * math.cos(la1),
                           math.cos(d) - math.sin(la1) * math.sin(la2))
    return math.degrees(la2), (math.degrees(lo2) + 540) % 360 - 180


def midpoint(a, b):
    la1, lo1 = math.radians(a[0]), math.radians(a[1])
    la2, lo2 = math.radians(b[0]), math.radians(b[1])
    dlo = lo2 - lo1
    bx = math.cos(la2) * math.cos(dlo)
    by = math.cos(la2) * math.sin(dlo)
    la3 = math.atan2(math.sin(la1) + math.sin(la2),
                     math.sqrt((math.cos(la1) + bx) ** 2 + by ** 2))
    lo3 = lo1 + math.atan2(by, math.cos(la1) + bx)
    return math.degrees(la3), (math.degrees(lo3) + 540) % 360 - 180


BEIJING = (39.9042, 116.4074)
SHANGHAI = (31.2304, 121.4737)
LONDON = (51.5074, -0.1278)
NEWYORK = (40.7128, -74.0060)

print('R =', R)
print('pi/2 * R (equator->pole) =', math.pi / 2 * R)
print('pi * R (antipodal) =', math.pi * R)

cases = [
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
for name, a, b in cases:
    d = hav(a, b)
    br, br2 = bearing(a, b)
    print(f'{name}: dist={d:.6f} km ({d/1.609344:.6f} mi, {d/1.852:.6f} nmi) '
          f'init_bearing={br:.6f} final_bearing={br2:.6f}')
    if name in ('beijing-shanghai', 'london-newyork', 'sf-tokyo', 'paris-berlin'):
        m = midpoint(a, b)
        print(f'  midpoint={m[0]:.6f}, {m[1]:.6f}')

# destination problem
for p, brg, dist in [((0, 0), 90, 1000), ((0, 0), 45, 1000), ((51.5074, -0.1278), 288.6, 5570.2),
                     ((0, 0), 90, 20015.087)]:
    dest = destination(p, brg, dist)
    check = hav(p, dest)
    print(f'dest from {p} brg={brg} d={dist}: lat={dest[0]:.6f} lon={dest[1]:.6f} check_dist={check:.6f}')

# DMS anchors
print('DMS 37d46\'30"N =', 37 + 46 / 60 + 30 / 3600)
print('DMS 122d25\'8.4"W =', -(122 + 25 / 60 + 8.4 / 3600))
# compass: 16-wind from bearing
for b in [0, 11.24, 11.26, 33.75, 56.25, 78.76, 101.25, 123.76, 146.25, 168.76, 191.25, 213.76, 236.25, 258.76, 281.25, 303.76, 326.25, 348.76, 360, 361]:
    idx = int(((b % 360) / 22.5 + 0.5) % 16)
    names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
    print(f'compass({b}) -> {names[idx]}')
