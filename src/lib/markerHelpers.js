import { sceneToWorld, worldToScene } from './geoTransform.js';

export const PLACEMENT_Y = 10;

export const DEFAULT_MARKER_FIELDS = {
  commonName: 'Unknown',
  species: 'Unknown',
  canopyRadiusFt: 14,
  condition: 'Unsurveyed',
  verified: false,
  notes: '',
  annualStormwaterGal: 0,
  annualCarbonLb: 0,
  carbonStoredLb: 0,
  coolingScore: 0,
  shadeSqft: 0,
};

export function formatMarkerId(index) {
  return `T-${String(index).padStart(3, '0')}`;
}

export function getMarkerSequence(id) {
  const match = /^T-(\d+)$/.exec(id ?? '');
  return match ? Number(match[1]) : 0;
}

export function estimateBenefits(marker) {
  const radius = Number(marker.canopyRadiusFt ?? marker.canopy_radius_ft ?? 14);
  const shadeSqft = Math.round(Math.PI * radius * radius);
  const annualStormwaterGal = Math.round(shadeSqft * 1.25);
  const annualCarbonLb = Math.round(radius * 2.8);
  const carbonStoredLb = Math.round(radius * radius * 1.7);
  const coolingScore = Math.min(100, Math.round(35 + radius * 2.4));
  return { shadeSqft, annualStormwaterGal, annualCarbonLb, carbonStoredLb, coolingScore };
}

export function createMarker(index, position, georef = null) {
  const [x, , z] = position;
  const marker = {
    id: formatMarkerId(index),
    x,
    y: PLACEMENT_Y,
    z,
    position: [x, PLACEMENT_Y, z],
    ...DEFAULT_MARKER_FIELDS,
  };
  if (georef) {
    try {
      const { lng, lat } = sceneToWorld(x, z, georef);
      marker.lng = lng;
      marker.lat = lat;
      marker.geo_source = 'derived';
    } catch {
      // no-op — georef solve may not have been run yet
    }
  }
  return marker;
}

export function normalizeMarker(marker) {
  const x = Number(marker?.x ?? marker?.position?.[0]);
  const z = Number(marker?.z ?? marker?.position?.[2]);

  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    console.warn('Skipping marker with invalid coordinates:', marker);
    return null;
  }

  const base = {
    ...DEFAULT_MARKER_FIELDS,
    ...marker,
    id: marker?.id ?? formatMarkerId(0),
    x,
    y: PLACEMENT_Y,
    z,
    position: [x, PLACEMENT_Y, z],
  };

  const est = estimateBenefits(base);
  return {
    ...base,
    shadeSqft: base.shadeSqft || est.shadeSqft,
    annualStormwaterGal: base.annualStormwaterGal || est.annualStormwaterGal,
    annualCarbonLb: base.annualCarbonLb || est.annualCarbonLb,
    carbonStoredLb: base.carbonStoredLb || est.carbonStoredLb,
    coolingScore: base.coolingScore || est.coolingScore,
  };
}

export function normalizeSupabaseMarker(row, georef = null) {
  let x, z;

  if (row.lng != null && row.lat != null && georef) {
    try {
      const pos = worldToScene(Number(row.lng), Number(row.lat), georef);
      x = pos.x;
      z = pos.z;
    } catch {
      x = Number(row.x);
      z = Number(row.z);
    }
  } else {
    x = Number(row.x);
    z = Number(row.z);
  }

  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    console.warn('Skipping Supabase marker with invalid coordinates:', row);
    return null;
  }

  const marker = {
    id: row.marker_code,
    marker_code: row.marker_code,
    x,
    y: PLACEMENT_Y,
    z,
    position: [x, PLACEMENT_Y, z],
    lng: row.lng != null ? Number(row.lng) : undefined,
    lat: row.lat != null ? Number(row.lat) : undefined,
    geo_source: row.geo_source ?? undefined,
    commonName: row.common_name ?? 'Unknown',
    common_name: row.common_name ?? 'Unknown',
    species: row.species ?? 'Unknown',
    condition: row.condition ?? 'Unsurveyed',
    canopyRadiusFt: Number(row.canopy_radius_ft ?? 14),
    canopy_radius_ft: Number(row.canopy_radius_ft ?? 14),
    verified: Boolean(row.verified),
    notes: row.notes ?? '',
    annualStormwaterGal: Number(row.annual_stormwater_gal ?? 0),
    annualCarbonLb: Number(row.annual_carbon_lb ?? 0),
    carbonStoredLb: Number(row.carbon_stored_lb ?? 0),
    coolingScore: Number(row.cooling_score ?? 0),
    shadeSqft: Number(row.shade_sqft ?? 0),
    data_status: row.data_status ?? 'sample',
    // Phase 4 characterization fields (may be null until characterization runs)
    dbh_in:               row.dbh_in != null ? Number(row.dbh_in) : null,
    height_ft:            row.height_ft != null ? Number(row.height_ft) : null,
    crown_spread_ft:      row.crown_spread_ft != null ? Number(row.crown_spread_ft) : null,
    crown_base_height_ft: row.crown_base_height_ft != null ? Number(row.crown_base_height_ft) : null,
    species_confidence:   row.species_confidence != null ? Number(row.species_confidence) : null,
    species_source:       row.species_source ?? 'manual',
    structure_source:     row.structure_source ?? 'manual',
    capture:              row.capture ?? null,
    photo_url:            row.photo_url ?? null,
  };

  const est = estimateBenefits(marker);
  if (!marker.shadeSqft) marker.shadeSqft = est.shadeSqft;
  if (!marker.annualStormwaterGal) marker.annualStormwaterGal = est.annualStormwaterGal;
  if (!marker.annualCarbonLb) marker.annualCarbonLb = est.annualCarbonLb;
  if (!marker.carbonStoredLb) marker.carbonStoredLb = est.carbonStoredLb;
  if (!marker.coolingScore) marker.coolingScore = est.coolingScore;

  return marker;
}

export function serializeMarkers(markers) {
  return markers.map((m) => ({
    id: m.id,
    x: Number(m.position[0].toFixed(3)),
    y: Number(m.position[1].toFixed(3)),
    z: Number(m.position[2].toFixed(3)),
    lng: m.lng,
    lat: m.lat,
    commonName: m.commonName,
    species: m.species,
    canopyRadiusFt: m.canopyRadiusFt,
    condition: m.condition,
  }));
}

export function formatBenefit(value, suffix) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? `${num} ${suffix}` : 'pending calibration';
}

export function formatVerified(verified) {
  return verified === true ? 'field verified' : 'sample / unverified';
}
