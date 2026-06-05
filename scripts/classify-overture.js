#!/usr/bin/env node
// classify-overture.js
//
// Reads raw Overture GeoJSON from public/data/overture/_raw/ and emits three
// clean, classified layers to public/data/overture/:
//
//   buildings.geojson  — building footprints with resolved height_m
//   greenspace.geojson — parks, grass, forest, natural land
//   hardscape.geojson  — roads (LineStrings) + parking/pedestrian (Polygons)
//
// NOTE: sidewalks and curbs are inconsistently mapped in open data — Overture
// inherits this from OSM. Expect good coverage of roads and parks; minimal
// coverage of individual footways inside block interiors.
//
// Usage:
//   node scripts/classify-overture.js

'use strict';

const fs   = require('fs');
const path = require('path');

const RAW = path.join(__dirname, '..', 'public', 'data', 'overture', '_raw');
const OUT = path.join(__dirname, '..', 'public', 'data', 'overture');

fs.mkdirSync(OUT, { recursive: true });

// ── Classification rule table — edit here to adjust layer assignment ──────────

const RULES = {
  // land_use `class` values → greenspace layer
  greenspace_land_use: new Set([
    'grass', 'park', 'recreation_ground', 'leisure', 'cemetery',
    'forest', 'nature_reserve', 'meadow', 'garden', 'allotments',
    'village_green', 'golf_course', 'orchard', 'farmland', 'pitch',
    'playground', 'greenery',
  ]),

  // land `class` values → greenspace layer
  greenspace_land: new Set([
    'wood', 'meadow', 'scrub', 'heath', 'grassland', 'grass',
    'farmland', 'orchard', 'peninsula', 'island',
  ]),

  // land_use `class` values → hardscape layer (as Polygons)
  hardscape_land_use: new Set([
    'parking', 'pedestrian', 'construction', 'brownfield',
  ]),

  // All transportation segment classes → hardscape layer (as LineStrings).
  // 'footway', 'cycleway', 'path' included — note sparse OSM coverage in NJ.
  hardscape_segment_include: new Set([
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
    'residential', 'service', 'living_street', 'pedestrian',
    'unclassified', 'footway', 'cycleway', 'path', 'bridleway', 'track',
  ]),
};

// ── Height resolution ladder ──────────────────────────────────────────────────
// Priority: measured height > floor estimate > default.
// Asbury Park is mostly 2–4 story; default 6 m (2 floors) is conservative.

function resolveHeight(props) {
  const h = Number(props.height);
  if (Number.isFinite(h) && h > 0) return { height_m: +h.toFixed(1), height_source: 'measured' };

  const floors = Number(props.num_floors ?? props.level);
  if (Number.isFinite(floors) && floors > 0) {
    return { height_m: +(floors * 3.2).toFixed(1), height_source: 'floors_estimate' };
  }

  return { height_m: 6, height_source: 'default' };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readRaw(file) {
  const p = path.join(RAW, file);
  if (!fs.existsSync(p)) {
    console.warn(`  ⚠  ${file} not found — skipping`);
    return { type: 'FeatureCollection', features: [] };
  }
  const fc = JSON.parse(fs.readFileSync(p, 'utf8'));
  console.log(`  read ${file}: ${fc.features.length} features`);
  return fc;
}

function writeLayer(name, features) {
  const fc = { type: 'FeatureCollection', features };
  fs.writeFileSync(path.join(OUT, `${name}.geojson`), JSON.stringify(fc));
  console.log(`  → ${name}.geojson (${features.length} features)`);
}

function getClass(props) {
  // Overture uses `class` or `subtype` depending on the theme / release version
  return props.class ?? props.subtype ?? props.fclass ?? '';
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\nReading raw files…');
const rawBuildings = readRaw('buildings.geojson');
const rawLandUse   = readRaw('land_use.geojson');
const rawLand      = readRaw('land.geojson');
const rawSegments  = readRaw('segment.geojson');

// ── Buildings ─────────────────────────────────────────────────────────────────

console.log('\nClassifying buildings…');
const buildingFeatures = rawBuildings.features
  .filter((f) => f.geometry && ['Polygon', 'MultiPolygon'].includes(f.geometry.type))
  .map((f) => {
    const { height_m, height_source } = resolveHeight(f.properties ?? {});
    const cls = getClass(f.properties ?? {});
    return {
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        id: f.id ?? f.properties?.id,
        class: cls || 'building',
        height_m,
        height_source,
      },
    };
  });

// ── Greenspace ────────────────────────────────────────────────────────────────

console.log('Classifying greenspace…');
const greenFeatures = [];

for (const f of rawLandUse.features) {
  if (!f.geometry) continue;
  const cls = getClass(f.properties ?? {});
  if (RULES.greenspace_land_use.has(cls)) {
    greenFeatures.push({
      type: 'Feature',
      geometry: f.geometry,
      properties: { id: f.id, class: cls, source: 'land_use' },
    });
  }
}

for (const f of rawLand.features) {
  if (!f.geometry) continue;
  const cls = getClass(f.properties ?? {});
  if (RULES.greenspace_land.has(cls)) {
    greenFeatures.push({
      type: 'Feature',
      geometry: f.geometry,
      properties: { id: f.id, class: cls, source: 'land' },
    });
  }
}

// ── Hardscape ─────────────────────────────────────────────────────────────────

console.log('Classifying hardscape…');
const hardFeatures = [];

// Road/path segments as LineStrings
for (const f of rawSegments.features) {
  if (!f.geometry) continue;
  const cls = getClass(f.properties ?? {});
  if (!cls || RULES.hardscape_segment_include.has(cls)) {
    hardFeatures.push({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        id: f.id,
        class: cls || 'unclassified',
        // Carry width if available — used for 3B surface generation
        width: f.properties?.width ?? null,
      },
    });
  }
}

// Parking / pedestrian areas as Polygons from land_use
for (const f of rawLandUse.features) {
  if (!f.geometry) continue;
  if (!['Polygon', 'MultiPolygon'].includes(f.geometry.type)) continue;
  const cls = getClass(f.properties ?? {});
  if (RULES.hardscape_land_use.has(cls)) {
    hardFeatures.push({
      type: 'Feature',
      geometry: f.geometry,
      properties: { id: f.id, class: cls, source: 'land_use' },
    });
  }
}

// ── Write output ──────────────────────────────────────────────────────────────

console.log('\nWriting classified layers…');
writeLayer('buildings',  buildingFeatures);
writeLayer('greenspace', greenFeatures);
writeLayer('hardscape',  hardFeatures);

// ── Summary ───────────────────────────────────────────────────────────────────

const hLines  = hardFeatures.filter((f) => f.geometry.type === 'LineString').length;
const hPolys  = hardFeatures.filter((f) => ['Polygon','MultiPolygon'].includes(f.geometry.type)).length;
const hMeas   = buildingFeatures.filter((f) => f.properties.height_source === 'measured').length;
const hEst    = buildingFeatures.filter((f) => f.properties.height_source === 'floors_estimate').length;
const hDef    = buildingFeatures.filter((f) => f.properties.height_source === 'default').length;

console.log('\n── Summary ──────────────────────────────────────────────────');
console.log(`Buildings : ${buildingFeatures.length} (measured: ${hMeas}, est: ${hEst}, default: ${hDef})`);
console.log(`Greenspace: ${greenFeatures.length}`);
console.log(`Hardscape : ${hardFeatures.length} (lines: ${hLines}, polys: ${hPolys})`);
console.log('\nDone. Commit public/data/overture/*.geojson');
