/**
 * Base-map tiles. Set in frontend/.env.local (see .env.example), then restart `npm run dev`:
 *   VITE_TILE_PROVIDER = osm (default, no key, street map only) | maptiler (needs VITE_TILE_KEY)
 *   VITE_TILE_STREET_STYLE / VITE_TILE_SATELLITE_STYLE = MapTiler map ids
 *   (defaults: streets-v4, hybrid = satellite imagery with roads and labels)
 */
export interface BaseLayerDef {
  name: string
  url: string
  attribution: string
  subdomains?: string
  maxZoom: number
}

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export const TILE_PROVIDER = String(import.meta.env.VITE_TILE_PROVIDER ?? 'osm').toLowerCase()
const KEY = String(import.meta.env.VITE_TILE_KEY ?? '')

export function baseLayers(): BaseLayerDef[] {
  if (TILE_PROVIDER === 'maptiler' && KEY) {
    const street = String(import.meta.env.VITE_TILE_STREET_STYLE ?? 'streets-v4')
    const sat = String(import.meta.env.VITE_TILE_SATELLITE_STYLE ?? 'hybrid')
    const attribution = '<a href="https://www.maptiler.com/copyright/">&copy; MapTiler</a> ' + OSM_ATTR
    const url = (style: string, ext: string) => `https://api.maptiler.com/maps/${style}/256/{z}/{x}/{y}.${ext}?key=${KEY}`
    return [
      { name: 'Street', url: url(street, 'png'), attribution, maxZoom: 19 },
      { name: 'Satellite', url: url(sat, 'jpg'), attribution, maxZoom: 19 },
    ]
  }
  // OpenStreetMap standard tiles: no key. Fine for development and a demo; see the OSM tile usage policy.
  return [
    {
      name: 'Street',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: OSM_ATTR,
      maxZoom: 19,
    },
  ]
}
