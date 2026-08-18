/**
 * Coordinate parsing tests for dsh-geodesy. Anchors: 37°46′30″N = 37.775,
 * 122°25′8.4″W = -122.419 (verified by the independent anchor script).
 */
import { describe, expect, it } from 'vitest'
import { parseCoordInput, parseToken } from '../src/coords.ts'

function expectPair(result: unknown): { latitude: number; longitude: number } {
  if (typeof result !== 'object' || result === null || 'error' in result || 'value' in result) {
    throw new Error(`expected a pair result, got ${JSON.stringify(result)}`)
  }
  return result as { latitude: number; longitude: number }
}

function expectSingle(result: unknown): { value: number; isLat: boolean } {
  if (typeof result !== 'object' || result === null || !('value' in result)) {
    throw new Error(`expected a single result, got ${JSON.stringify(result)}`)
  }
  return result as { value: number; isLat: boolean }
}

describe('parseToken — decimal', () => {
  it('parses a plain positive decimal with a kind hint', () => {
    const result = parseToken('37.775', 'lat')
    expect(result).toEqual({ value: 37.775, isLat: true })
  })

  it('parses a signed decimal', () => {
    const result = parseToken('-122.419', 'lon')
    expect(result).toEqual({ value: -122.419, isLat: false })
  })

  it('parses a suffixed decimal without a hint', () => {
    expect(parseToken('122.419W', 'auto')).toEqual({ value: -122.419, isLat: false })
    expect(parseToken('37.775N', 'auto')).toEqual({ value: 37.775, isLat: true })
  })

  it('parses a trailing degree symbol', () => {
    expect(parseToken('37.775°', 'lat')).toEqual({ value: 37.775, isLat: true })
  })

  it('rejects a conflicting minus sign with an S/W suffix', () => {
    const result = parseToken('-37.5S', 'auto')
    expect('error' in result).toBe(true)
  })

  it('rejects out-of-range values', () => {
    expect('error' in parseToken('91', 'lat')).toBe(true)
    expect('error' in parseToken('181', 'lon')).toBe(true)
    expect('error' in parseToken('-91', 'lat')).toBe(true)
  })

  it('rejects a bare number without hint or suffix', () => {
    const result = parseToken('37', 'auto')
    expect('error' in result).toBe(true)
  })
})

describe('parseToken — DMS', () => {
  it('parses 37°46′30″N to 37.775', () => {
    expect(parseToken('37°46′30″N', 'auto')).toEqual({ value: 37.775, isLat: true })
  })

  it('parses 122°25′8.4″W to -122.419', () => {
    const result = parseToken('122°25′8.4″W', 'auto')
    if ('error' in result) throw new Error(result.error)
    expect(result.value).toBeCloseTo(-122.419, 9)
    expect(result.isLat).toBe(false)
  })

  it('parses letter notation 37d46m30sN', () => {
    expect(parseToken('37d46m30sN', 'auto')).toEqual({ value: 37.775, isLat: true })
  })

  it('parses colon notation 37:46:30N', () => {
    expect(parseToken('37:46:30N', 'auto')).toEqual({ value: 37.775, isLat: true })
  })

  it('parses plain-number notation "37 46 30 N"', () => {
    expect(parseToken('37 46 30 N', 'auto')).toEqual({ value: 37.775, isLat: true })
  })

  it('parses degrees with decimal minutes "37 46.5 N"', () => {
    expect(parseToken('37 46.5 N', 'auto')).toEqual({ value: 37.775, isLat: true })
  })

  it('parses DMS without any suffix when hinted', () => {
    expect(parseToken('37°46′30″', 'lat')).toEqual({ value: 37.775, isLat: true })
  })

  it('parses fractional seconds', () => {
    const result = parseToken('12°0′30.6″N', 'auto')
    if ('error' in result) throw new Error(result.error)
    expect(result.value).toBeCloseTo(12.0085, 9)
  })

  it('rejects minutes ≥ 60', () => {
    expect('error' in parseToken('37°60′0″N', 'auto')).toBe(true)
  })

  it('rejects seconds ≥ 60', () => {
    expect('error' in parseToken('37°46′60″N', 'auto')).toBe(true)
  })

  it('applies W suffix as negative for DMS', () => {
    const result = parseToken('122:25:8.4W', 'auto')
    if ('error' in result) throw new Error(result.error)
    expect(result.value).toBeCloseTo(-122.419, 9)
  })

  it('rejects a DMS value out of range', () => {
    expect('error' in parseToken('91°0′0″N', 'auto')).toBe(true)
  })
})

describe('parseCoordInput — pairs', () => {
  it('parses a comma pair in lat, lon order', () => {
    const result = expectPair(parseCoordInput('39.9042, 116.4074', 'auto'))
    expect(result.latitude).toBeCloseTo(39.9042, 9)
    expect(result.longitude).toBeCloseTo(116.4074, 9)
  })

  it('parses a comma pair with suffixes in lon, lat order', () => {
    const result = expectPair(parseCoordInput('116.4074E, 39.9042N', 'auto'))
    expect(result.latitude).toBeCloseTo(39.9042, 9)
    expect(result.longitude).toBeCloseTo(116.4074, 9)
  })

  it('parses a suffix pair without comma', () => {
    const result = expectPair(parseCoordInput('39°54′15″N 116°23′27″E', 'auto'))
    expect(result.latitude).toBeCloseTo(39.904167, 6)
    expect(result.longitude).toBeCloseTo(116.390833, 6)
  })

  it('parses a mixed pair: suffixed first, plain second', () => {
    const result = expectPair(parseCoordInput('116.4074E 39.9042', 'auto'))
    expect(result.latitude).toBeCloseTo(39.9042, 9)
    expect(result.longitude).toBeCloseTo(116.4074, 9)
  })

  it('parses a mixed pair: plain first, suffixed second', () => {
    const result = expectPair(parseCoordInput('39.9042 116.4074E', 'auto'))
    expect(result.latitude).toBeCloseTo(39.9042, 9)
    expect(result.longitude).toBeCloseTo(116.4074, 9)
  })

  it('rejects a pair with two latitudes', () => {
    expect('error' in parseCoordInput('39.9N, 40.7N', 'auto')).toBe(true)
  })

  it('swaps a comma pair when suffixes say lon, lat', () => {
    const result = expectPair(parseCoordInput('8.9E, 51.5N', 'auto'))
    expect(result.latitude).toBeCloseTo(51.5, 9)
    expect(result.longitude).toBeCloseTo(8.9, 9)
  })

  it('treats two plain space-separated numbers as DMS but requires a kind hint for the axis', () => {
    // "37 46.5" parses as DMS 37°46.5′ — but with no suffix and no hint the axis is unknown
    expect('error' in parseCoordInput('37 46.5', 'auto')).toBe(true)
    const hinted = expectSingle(parseCoordInput('37 46.5', 'lat'))
    expect(hinted.value).toBeCloseTo(37.775, 9)
  })

  it('rejects more than two comma parts', () => {
    expect('error' in parseCoordInput('1, 2, 3', 'auto')).toBe(true)
  })
})

describe('parseCoordInput — single coordinates', () => {
  it('parses a single suffixed coordinate', () => {
    const result = expectSingle(parseCoordInput('37°46′30″N', 'auto'))
    expect(result).toEqual({ value: 37.775, isLat: true })
  })

  it('parses a single unsuffixed coordinate with kind hint', () => {
    const result = expectSingle(parseCoordInput('116.4074', 'lon'))
    expect(result).toEqual({ value: 116.4074, isLat: false })
  })

  it('rejects an unsuffixed single coordinate without a kind hint', () => {
    expect('error' in parseCoordInput('116.4074', 'auto')).toBe(true)
  })

  it('rejects garbage input with a helpful message', () => {
    const result = parseCoordInput('nowhere near a coordinate', 'auto')
    expect('error' in result).toBe(true)
  })

  it('rejects an empty string', () => {
    expect('error' in parseCoordInput('', 'auto')).toBe(true)
  })
})
