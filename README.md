# dsh-geodesy

Geodesic math toolbox for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh): great-circle distances, bearings, destination points, and DMS coordinate parsing — all as local, deterministic tools with **zero runtime dependencies**.

> 中文简介：dsh 插件「大地测量工具箱」——大圆距离、方位角、目的地推算与 DMS 坐标解析四个纯计算工具，零运行时依赖。专治大模型手算球面距离/坐标换算的常见错误（弧度与角度混用、忘记地球半径、经纬度顺序颠倒等）。

## Why

LLMs reliably fumble geodesic math: they mix up latitude/longitude order, use the wrong Earth radius, forget degrees→radians, and botch DMS conversions. This plugin moves that math out of the model's head and into exact spherical trigonometry:

- `geo_distance` — great-circle distance (haversine) between two points, with initial/final bearings and the 16-wind compass direction; results in km, m, mi, or nmi
- `geo_bearing` — initial & final great-circle bearings plus the great-circle midpoint of two points
- `geo_destination` — the direct geodesic problem: given a start point, bearing and distance, compute the destination (with a round-trip distance check)
- `coord_parse` — parse and validate coordinate strings (decimal, DMS, suffixes, pairs) and convert them to decimal degrees + formatted DMS

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

### Examples

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

`coord_parse`:

```json
{
  "valid": true,
  "input": "37°46′30″N, 122°25′8.4″W",
  "latitude": 37.775,
  "longitude": -122.419,
  "latDms": "37°46′30″N",
  "lonDms": "122°25′8.4″W"
}
```

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
pnpm test     # 115 tests, anchored to independently computed closed-form values
pnpm lint
```

## License

MIT © TYEclipse
