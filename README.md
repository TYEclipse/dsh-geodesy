# dsh-geodesy

Geodesic math toolbox for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh): great-circle distances, bearings, destination points, DMS parsing, rhumb lines, path intersections, and spherical polygon areas — all as local, deterministic tools with **zero runtime dependencies**.

> 中文简介：dsh 插件「大地测量工具箱」——大圆距离、方位角、目的地推算、DMS 坐标解析、恒向线（罗盘等角航线）距离、两条大圆路径交点、球面多边形面积共七个纯计算工具，零运行时依赖。专治大模型手算球面几何的常见错误（弧度与角度混用、经纬度顺序颠倒、忘记地球半径、把球面多边形当平面算等）。

## Why

LLMs reliably fumble geodesic math: they mix up latitude/longitude order, use the wrong Earth radius, forget degrees→radians, botch DMS conversions, and treat spherical polygons as planar. This plugin moves that math out of the model's head and into exact spherical trigonometry:

- `geo_distance` — great-circle distance (haversine) between two points, with initial/final bearings and the 16-wind compass direction; results in km, m, mi, or nmi
- `geo_bearing` — initial & final great-circle bearings plus the great-circle midpoint of two points
- `geo_destination` — the direct geodesic problem: given a start point, bearing and distance, compute the destination (with a round-trip distance check)
- `coord_parse` — parse and validate coordinate strings (decimal, DMS, suffixes, pairs) and convert them to decimal degrees + formatted DMS
- `geo_rhumb` — rhumb-line (constant-heading / loxodrome) distance and bearing between two points, with the great-circle distance for comparison
- `geo_intersection` — where two great-circle paths (start point + initial bearing each) cross; reports the nearest crossing, the antipodal crossing, and distances from both starts
- `geo_area` — area and perimeter of a spherical polygon via spherical excess (Girard's theorem), with the complementary region's area always included

All math uses the IUGG mean Earth radius 6371.0088 km (configurable via the plugin `radiusKm` option, e.g. for lunar or planetary calculations).

## Install

```sh
dsh plugin --profile web add github:TYEclipse/dsh-geodesy
```

Requires `pnpm` on your PATH. Then restart the profile's services (or `dsh restart web`).

## Usage

Ask the agent questions that involve Earth-surface math; it will call the tools automatically:

- "What is the great-circle distance from Beijing to Shanghai?"
- "Which direction is New York from London, and where is the midpoint?"
- "I'm 200 km due east of Paris — where am I?"
- "Parse 37°46′30″N, 122°25′8.4″W into decimal degrees."
- "How far do I sail from (45°N, 0°) to (45°N, 90°) at a constant heading, and how much longer is that than the great circle?"
- "Where does the flight corridor starting at (0, 0) heading due east cross the one starting at (0, 90) heading due north?"
- "What is the area of the triangle (0,0), (0,90), (90,0) on the sphere?"

### Examples

`geo_rhumb` — (45°N, 0°) → (45°N, 90°) at constant heading:

```json
{
  "valid": true,
  "unit": "km",
  "distance": 7076.411574,
  "kilometers": 7076.411574,
  "miles": 4397.078297,
  "nauticalMiles": 3820.956573,
  "bearing": 90,
  "compass": "E",
  "greatCircleKm": 6671.704814
}
```

`geo_intersection` — equator (east from (0,0)) × meridian (north from (0,90)):

```json
{
  "valid": true,
  "lat": 0,
  "lon": 90,
  "distanceFromStart1Km": 10007.557221,
  "distanceFromStart2Km": 0,
  "antipodeLat": 0,
  "antipodeLon": -90,
  "antipodeDistanceFromStart1Km": 10007.557221,
  "antipodeDistanceFromStart2Km": 20015.114442
}
```

`geo_area` — the octant triangle (0,0), (0,90), (90,0): exactly one eighth of the sphere:

```json
{
  "valid": true,
  "vertices": 3,
  "areaKm2": 63758235.121609,
  "perimeterKm": 30022.671663,
  "excessRadians": 1.5707963268,
  "complementKm2": 446307645.851263
}
```

`geo_distance` — Beijing (39.9042, 116.4074) → Shanghai (31.2304, 121.4737):

```json
{
  "valid": true,
  "unit": "km",
  "distance": 1067.311645,
  "kilometers": 1067.311645,
  "miles": 663.196709,
  "nauticalMiles": 576.302184,
  "initialBearing": 153.072675,
  "finalBearing": 156.029266,
  "compass": "SSE"
}
```

## Semantics notes

- **`geo_area` winding**: the reported area is the region to the LEFT of the directed edges. Counter-clockwise vertex order (seen from outside the sphere) yields the polygon itself; clockwise order yields its complement. `complementKm2` is always included, so either region is one field away. The polygon must be simple (non-self-intersecting); at most 100 vertices.
- **`geo_intersection`** reports the crossing nearest to the first path's start; when that crossing lies on the reverse side of path 1 (bearing from start 1 differs by ~180°), a `note` says so and the antipodal crossing is the one ahead.
- **`geo_rhumb`** returns bearing 0 for zero-length lines (no unique heading exists).

## Coordinate input formats

`coord_parse` accepts, deterministically:

| Input | Meaning |
|---|---|
| `39.9042, 116.4074` | decimal pair, `lat, lon` order |
| `116.4074E, 39.9042N` | pair with suffixes — order is irrelevant, axes come from suffixes |
| `39°54′15″N 116°23′27″E` | DMS pair (comma optional when suffixed) |
| `37°46′30″N` / `37d46m30sN` / `37:46:30N` / `37 46 30 N` | single DMS coordinate |
| `37.775N` / `-122.419` | single decimal (negative = S/W) |
| `37.775`, `kind: "lat"` | unsuffixed single value with an explicit axis hint |

Invalid input returns `valid: false` with a reason — never a silent guess.

## Tools

| Tool | Purpose |
|---|---|
| `geo_distance` | haversine distance, km/m/mi/nmi, initial & final bearing, compass point |
| `geo_bearing` | initial/final bearings + great-circle midpoint |
| `geo_destination` | destination point from start + bearing + distance, with round-trip check |
| `coord_parse` | parse/validate decimal & DMS coordinate strings → decimal degrees + DMS |
| `geo_rhumb` | constant-heading distance + bearing (loxodrome), great-circle comparison |
| `geo_intersection` | crossing of two great-circle paths (+ antipodal crossing, distances from starts) |
| `geo_area` | spherical polygon area + perimeter (spherical excess), complement area |

## Configuration

```yaml
plugins:
  dsh-geodesy:
    radiusKm: 6371.0088   # sphere radius; use 1737.4 for the Moon, 3389.5 for Mars
```

## Development

```sh
pnpm install
pnpm build
pnpm test     # 154 tests, anchored to independently computed closed-form values
pnpm lint
```

## License

MIT © TYEclipse
