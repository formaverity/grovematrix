#!/usr/bin/env node
// buffer-hardscape.js
//
// Reads public/data/overture/hardscape.geojson (LineStrings + parking Polygons)
// and emits public/data/overture/hardscape_surfaces.geojson with:
//   - Road/path LineStrings buffered to Polygons by a class-based default width
//   - Existing parking/pedestrian Polygons passed through unchanged
//
// NOTE: sidewalk coverage is partial and curbs are essentially absent in
// open data. Road surfaces will be incomplete inside block interiors.
// Buffer uses metric distances in lng/lat space via @turf/buffer (geodesic).
//
// Usage: node scripts/buffer-hardscape.js

'use strict';

const fs   = require('fs');
const path = require('path');
const buffer = require('@turf/buffer').default ?? require('@turf/buffer');

// ── Width table (half-width per class, in metres) ────────────────────────────
// These are typical US road half-widths. Edit to match local conditions.
const CLASS_HALF_WIDTH_M = {
  motorway:          7.0,
  trunk:             6.0,
  primary:           5.0,
  secondary:         4.5,
  tertiary:          4.0,
  residential:       3.0,
  living_street:     3.0,
  unclassified:      3.0,
  service:           2.5,
  pedestrian:        2.0,
  footway:           1.0,   // inconsistently mapped; surfaces will be incomplete
  cycleway:          1.0,
  path:              0.75,
  track:             0.75,
  bridleway:         1.0,
};
const DEFAULT_HALF_WIDTH_M = 2.0;

// ── Load input ────────────────────────────────────────────────────────────────

const inPath  = path.join(__dirname, '..', 'public', 'data', 'overture', 'hardscape.geojson');
const outPath = path.join(__dirname, '..', 'public', 'data', 'overture', 'hardscape_surfaces.geojson');

if (!fs.existsSync(inPath)) {
  console.error(`Input not found: ${inPath}`);
  console.error('Run scripts/classify-overture.js first.');
  process.exit(1);
}

const fc = JSON.parse(fs.readFileSync(inPath, 'utf8'));
console.log(`Input: ${fc.features.length} features`);

const outputFeatures = [];
let buffered = 0, passThrough = 0, errors = 0;

// ── Process features ──────────────────────────────────────────────────────────

for (const feature of fc.features) {
  const geomType = feature.geometry?.type;

  if (geomType === 'LineString' || geomType === 'MultiLineString') {
    const cls = feature.properties?.class ?? '';
    // Use explicit width from property if available, else class default
    const rawWidth = feature.properties?.width;
    const halfW = rawWidth != null && Number.isFinite(Number(rawWidth))
      ? Number(rawWidth) / 2
      : (CLASS_HALF_WIDTH_M[cls] ?? DEFAULT_HALF_WIDTH_M);

    try {
      const buffered_feat = buffer(feature, halfW, { units: 'meters' });
      if (buffered_feat?.geometry) {
        buffered_feat.properties = {
          ...feature.properties,
          buffer_half_m: halfW,
          source: 'buffered_road',
        };
        outputFeatures.push(buffered_feat);
        buffered++;
      }
    } catch (err) {
      errors++;
      // skip invalid geometries silently
    }

  } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
    // Parking/pedestrian polygons pass through unchanged
    outputFeatures.push(feature);
    passThrough++;
  }
  // Other geometry types skipped
}

// ── Write output ──────────────────────────────────────────────────────────────

const output = { type: 'FeatureCollection', features: outputFeatures };
fs.writeFileSync(outPath, JSON.stringify(output));

console.log(`Output: ${outputFeatures.length} features`);
console.log(`  Buffered roads   : ${buffered}`);
console.log(`  Passed-through   : ${passThrough}`);
console.log(`  Skipped (errors) : ${errors}`);
console.log(`  → ${outPath}`);
console.log('\nDone. Commit public/data/overture/hardscape_surfaces.geojson');
