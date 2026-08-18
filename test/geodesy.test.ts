/**
 * Core math tests for dsh-geodesy. Every numeric assertion is anchored to a
 * value produced by an independent closed-form script (test/anchors.py) —
 * no values were derived from the implementation itself.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIUS_KM,
  compassPoint,
  destinationPoint,
  finalBearing,
  formatDms,
  haversineKm,
  initialBearing,
  midpointOf,
  round,
  validatePoint,
} from '../src/geodesy.ts'

const BEIJING = { lat: 39.9042, lon: 116.4074 }
const SHANGHAI = { lat: 31.2304, lon: 121.4737 }
const LONDON = { lat: 51.5074, lon: -0.1278 }
const NEW_YORK = { lat: 40.7128, lon: -74.006 }
const SF = { lat: 37.7749, lon: -122.4194 }
const TOKYO = { lat: 35.6762, lon: 139.6503 }
const PARIS = { lat: 48.8566, lon: 2.3522 }
const BERLIN = { lat: 52.52, lon: 13.405 }

describe('haversineKm', () => {
  it('matches the independent anchor for Beijing → Shanghai', () => {
    expect(haversineKm(BEIJING, SHANGHAI)).toBeCloseTo(1067.311645, 4)
  })

  it('matches the independent anchor for London → New York', () => {
    expect(haversineKm(LONDON, NEW_YORK)).toBeCloseTo(5570.229874, 4)
  })

  it('matches the independent anchor for Sydney → Rio (long haul)', () => {
    expect(haversineKm({ lat: -33.8688, lon: 151.2093 }, { lat: -22.9068, lon: -43.1729 })).toBeCloseTo(13521.051897, 4)
  })

  it('gives exactly one equatorial degree as 111.195080 km', () => {
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111.19508, 6)
  })

  it('gives the quarter-meridian as pi/2 * R', () => {
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 90, lon: 0 })).toBeCloseTo(10007.557221, 4)
  })

  it('handles antipodal points without blowing up', () => {
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(20015.114442, 4)
  })

  it('returns 0 for identical points', () => {
    expect(haversineKm({ lat: 37.775, lon: -122.419 }, { lat: 37.775, lon: -122.419 })).toBe(0)
  })

  it('is symmetric', () => {
    expect(haversineKm(SF, TOKYO)).toBeCloseTo(haversineKm(TOKYO, SF), 9)
  })

  it('uses the configured radius', () => {
    const moon = haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, 1737.4)
    // 2*pi*1737.4/360 ≈ 30.322 km per lunar degree
    expect(moon).toBeCloseTo(30.3225, 2)
  })
})

describe('initialBearing / finalBearing', () => {
  it('matches anchors for Beijing → Shanghai', () => {
    expect(initialBearing(BEIJING, SHANGHAI)).toBeCloseTo(153.072675, 4)
    expect(finalBearing(BEIJING, SHANGHAI)).toBeCloseTo(156.029266, 4)
  })

  it('matches anchors for London → New York', () => {
    expect(initialBearing(LONDON, NEW_YORK)).toBeCloseTo(288.329702, 4)
    expect(finalBearing(LONDON, NEW_YORK)).toBeCloseTo(231.212617, 4)
  })

  it('is due east along the equator', () => {
    expect(initialBearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 9)
    expect(finalBearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 9)
  })

  it('is due north towards the pole', () => {
    expect(initialBearing({ lat: 0, lon: 0 }, { lat: 90, lon: 0 })).toBeCloseTo(0, 9)
    expect(finalBearing({ lat: 0, lon: 0 }, { lat: 90, lon: 0 })).toBeCloseTo(0, 9)
  })

  it('matches anchors for Paris → Berlin', () => {
    expect(initialBearing(PARIS, BERLIN)).toBeCloseTo(58.176742, 4)
    expect(finalBearing(PARIS, BERLIN)).toBeCloseTo(66.743423, 4)
  })

  it('the final bearing equals the reverse of the return initial bearing', () => {
    expect(finalBearing(SF, TOKYO)).toBeCloseTo((initialBearing(TOKYO, SF) + 180) % 360, 9)
  })
})

describe('destinationPoint', () => {
  it('1000 km due east from the origin lands on the equator', () => {
    const dest = destinationPoint({ lat: 0, lon: 0 }, 90, 1000)
    expect(dest.lat).toBeCloseTo(0, 9)
    expect(dest.lon).toBeCloseTo(8.993204, 4)
  })

  it('1000 km at 45° from the origin', () => {
    const dest = destinationPoint({ lat: 0, lon: 0 }, 45, 1000)
    expect(dest.lat).toBeCloseTo(6.346043, 4)
    expect(dest.lon).toBeCloseTo(6.385331, 4)
  })

  it('London → 5570.2 km at 288.6° lands near New York', () => {
    const dest = destinationPoint(LONDON, 288.6, 5570.2)
    expect(dest.lat).toBeCloseTo(40.874659, 4)
    expect(dest.lon).toBeCloseTo(-74.177176, 4)
  })

  it('round-trips: haversine back to the start equals the travelled distance', () => {
    const start = { lat: 48.8566, lon: 2.3522 }
    const dest = destinationPoint(start, 123.4, 4321)
    expect(haversineKm(start, dest)).toBeCloseTo(4321, 6)
  })

  it('normalizes the destination longitude into [-180, 180)', () => {
    const dest = destinationPoint({ lat: 0, lon: 170 }, 90, 2000)
    expect(dest.lon).toBeLessThan(180)
    expect(dest.lon).toBeGreaterThanOrEqual(-180)
  })

  it('near-antipodal travel stays finite', () => {
    const dest = destinationPoint({ lat: 0, lon: 0 }, 90, 20015.087)
    expect(Number.isFinite(dest.lat)).toBe(true)
    expect(Number.isFinite(dest.lon)).toBe(true)
    expect(haversineKm({ lat: 0, lon: 0 }, dest)).toBeCloseTo(20015.087, 4)
  })
})

describe('midpointOf', () => {
  it('matches the anchor for Beijing ↔ Shanghai', () => {
    const mid = midpointOf(BEIJING, SHANGHAI)
    expect(mid.lat).toBeCloseTo(35.593729, 4)
    expect(mid.lon).toBeCloseTo(119.07801, 4)
  })

  it('matches the anchor for London ↔ New York (mid-Atlantic)', () => {
    const mid = midpointOf(LONDON, NEW_YORK)
    expect(mid.lat).toBeCloseTo(52.36844, 4)
    expect(mid.lon).toBeCloseTo(-41.290307, 4)
  })

  it('is the same point when both endpoints coincide', () => {
    const mid = midpointOf(SF, SF)
    expect(mid.lat).toBeCloseTo(SF.lat, 9)
    expect(mid.lon).toBeCloseTo(SF.lon, 9)
  })
})

describe('compassPoint', () => {
  const cases: Array<[number, string]> = [
    [0, 'N'], [11.24, 'N'], [11.26, 'NNE'], [33.75, 'NE'], [56.25, 'ENE'],
    [78.76, 'E'], [101.25, 'ESE'], [123.76, 'SE'], [146.25, 'SSE'], [168.76, 'S'],
    [191.25, 'SSW'], [213.76, 'SW'], [236.25, 'WSW'], [258.76, 'W'], [281.25, 'WNW'],
    [303.76, 'NW'], [326.25, 'NNW'], [348.76, 'N'], [360, 'N'], [361, 'N'],
  ]
  it.each(cases)('maps %f° to %s', (bearing, expected) => {
    expect(compassPoint(bearing)).toBe(expected)
  })

  it('maps the Beijing → Shanghai initial bearing to SSE', () => {
    expect(compassPoint(153.072675)).toBe('SSE')
  })

  it('handles negative bearings by wrapping', () => {
    expect(compassPoint(-12)).toBe(compassPoint(348))
  })
})

describe('formatDms', () => {
  it('formats 37.775 as 37°46′30″N', () => {
    expect(formatDms(37.775, true)).toBe('37°46′30″N')
  })

  it('formats -122.419 as 122°25′8.4″W', () => {
    expect(formatDms(-122.419, false)).toBe('122°25′8.4″W')
  })

  it('formats whole degrees without dust', () => {
    expect(formatDms(90, true)).toBe('90°0′0″N')
    expect(formatDms(-180, false)).toBe('180°0′0″W')
  })

  it('carries seconds overflow into minutes', () => {
    // 12.9999996° → 12°59′59.999″ → rounds up to 13°0′0″
    expect(formatDms(12.9999996, true)).toBe('13°0′0″N')
  })

  it('uses S/W suffixes for negatives', () => {
    expect(formatDms(-33.8688, true)).toBe('33°52′7.7″S')
    expect(formatDms(151.2093, false)).toBe('151°12′33.5″E')
  })
})

describe('validatePoint', () => {
  it('accepts valid points', () => {
    expect(validatePoint(0, 0)).toBeUndefined()
    expect(validatePoint(-90, 180)).toBeUndefined()
    expect(validatePoint(90, -180)).toBeUndefined()
  })

  it('rejects out-of-range latitudes', () => {
    expect(validatePoint(90.1, 0)).toContain('latitude')
    expect(validatePoint(-91, 0)).toContain('latitude')
  })

  it('rejects out-of-range longitudes', () => {
    expect(validatePoint(0, 180.5)).toContain('longitude')
    expect(validatePoint(0, -181)).toContain('longitude')
  })

  it('rejects non-finite numbers', () => {
    expect(validatePoint(Number.NaN, 0)).toBeDefined()
    expect(validatePoint(0, Number.POSITIVE_INFINITY)).toBeDefined()
  })
})

describe('round', () => {
  it('rounds to the requested precision', () => {
    expect(round(1067.31164539, 6)).toBe(1067.311645)
    expect(round(0.5, 0)).toBe(1)
  })

  it('leaves the default radius untouched by sanity checks', () => {
    expect(DEFAULT_RADIUS_KM).toBe(6371.0088)
  })
})
