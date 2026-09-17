import { DEFAULT_GEOCODER } from './config.js'

export interface Place {
  name: string
  context: string
  lat: number
  lng: number
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: Record<string, string | undefined>
}

/** Photon returns GeoJSON; build a readable label from its fields. */
export async function geocode(
  query: string,
  opts: {
    near?: [number, number] | null
    signal?: AbortSignal
    url?: string
    limit?: number
  } = {},
): Promise<Place[]> {
  if (query.trim().length < 3) return []

  const url = new URL(opts.url ?? DEFAULT_GEOCODER)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(opts.limit ?? 6))
  if (opts.near) {
    url.searchParams.set('lon', String(opts.near[0]))
    url.searchParams.set('lat', String(opts.near[1]))
  }

  const res = await fetch(url, { signal: opts.signal })
  if (!res.ok) throw new Error(`Search is unavailable (${res.status})`)

  const body = (await res.json()) as { features?: PhotonFeature[] }
  return (body.features ?? []).map((f) => {
    const p = f.properties
    const context = [p.street, p.city ?? p.district, p.state, p.country]
      .filter(Boolean)
      .join(', ')
    return {
      name: p.name || p.street || p.city || 'Unnamed place',
      context,
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }
  })
}

/**
 * A geocoder result as a line somebody would write on an envelope.
 *
 * Two repeats to clear, both of which Photon produces for ordinary addresses:
 * the street twice (`name` is the house number on the street `context` then
 * opens with), and the city and state when they are the same place — New York,
 * New York. The street test only looks at the first part, because testing them
 * all would eat the city out of "New York Public Library, Fifth Avenue, New
 * York".
 */
export function placeLabel({ name, context }: Place): string {
  const parts = context ? context.split(', ') : []
  if (parts[0] && name.toLowerCase().includes(parts[0].toLowerCase())) parts.shift()
  const deduped = parts.filter((part, i) => part !== parts[i - 1])
  return [name, ...deduped].filter(Boolean).join(', ').slice(0, 200)
}
