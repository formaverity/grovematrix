// cityData.js — loads and caches the three classified Overture GeoJSON layers.
// Both Map2D and (future) City3D consume this module.
// Returns empty FeatureCollections gracefully when files are absent.

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

const cache = {};

const LAYER_PATHS = {
  buildings:          '/data/overture/buildings.geojson',
  greenspace:         '/data/overture/greenspace.geojson',
  hardscape:          '/data/overture/hardscape.geojson',
  hardscape_surfaces: '/data/overture/hardscape_surfaces.geojson',
};

export async function getLayer(name) {
  if (cache[name]) return cache[name];

  const url = LAYER_PATHS[name];
  if (!url) return EMPTY_FC;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      // File not yet generated — ETL not run yet.
      cache[name] = EMPTY_FC;
    } else {
      cache[name] = await res.json();
    }
  } catch {
    cache[name] = EMPTY_FC;
  }

  return cache[name];
}

// Call after re-running classify-overture.js to bust the in-memory cache.
export function clearCache() {
  Object.keys(cache).forEach((k) => delete cache[k]);
}

// True only if all three layers have been fetched and have features.
export async function allLayersReady() {
  const [b, g, h] = await Promise.all([
    getLayer('buildings'),
    getLayer('greenspace'),
    getLayer('hardscape'),
  ]);
  return b.features.length > 0 || g.features.length > 0 || h.features.length > 0;
}
