#!/usr/bin/env node
// derive-bbox.js
//
// Reads the backfilled tree-markers.json and computes a padded bounding box
// suitable for the Overture Maps fetch. Prints W,S,E,N and the exact
// overturemaps / DuckDB commands to run.
//
// Usage:
//   node scripts/derive-bbox.js [--pad 0.004]

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

const PAD_ARG = process.argv.find((a) => a.startsWith('--pad='));
const PAD     = PAD_ARG ? parseFloat(PAD_ARG.split('=')[1]) : 0.004; // ~400 m

const markersPath = path.join(__dirname, '..', 'public', 'data', 'tree-markers.json');

// ── Load markers ──────────────────────────────────────────────────────────────

const markers = JSON.parse(fs.readFileSync(markersPath, 'utf8'));
const geo     = markers.filter((m) => m.lng != null && m.lat != null);

if (!geo.length) {
  console.error('No georeferenced markers in tree-markers.json. Run backfill first.');
  process.exit(1);
}

const lngs = geo.map((m) => m.lng);
const lats  = geo.map((m) => m.lat);

const W = +(Math.min(...lngs) - PAD).toFixed(7);
const S = +(Math.min(...lats) - PAD).toFixed(7);
const E = +(Math.max(...lngs) + PAD).toFixed(7);
const N = +(Math.max(...lats) + PAD).toFixed(7);

const bbox = `${W},${S},${E},${N}`;

// ── Output ────────────────────────────────────────────────────────────────────

console.log(`\nMarkers with georef : ${geo.length} / ${markers.length}`);
console.log(`Lng extent          : ${Math.min(...lngs).toFixed(6)} → ${Math.max(...lngs).toFixed(6)}`);
console.log(`Lat extent          : ${Math.min(...lats).toFixed(6)} → ${Math.max(...lats).toFixed(6)}`);
console.log(`Padding             : ±${PAD}° (~${Math.round(PAD * 111_000)} m)`);
console.log(`\nBbox (W,S,E,N): ${bbox}\n`);

const OUT = 'public/data/overture/_raw';

const types = [
  { type: 'building',  file: 'buildings.geojson'  },
  { type: 'land_use',  file: 'land_use.geojson'   },
  { type: 'land',      file: 'land.geojson'        },
  { type: 'segment',   file: 'segment.geojson'     },
];

console.log('── overturemaps CLI (pip install overturemaps) ──');
for (const { type, file } of types) {
  console.log(`overturemaps download --bbox=${bbox} -f geojson --type=${type} -o ${OUT}/${file}`);
}

console.log('\n── DuckDB fallback (duckdb :memory: < script.sql) ──');
console.log(`-- Run once: INSTALL spatial; INSTALL httpfs; LOAD spatial; LOAD httpfs;`);
const RELEASE = 's3://overturemaps-us-west-2/release/2025-05-21.0';
const duckTypes = [
  { theme: 'buildings',      type: 'building',  file: 'buildings.geojson'  },
  { theme: 'places',         type: 'land_use',  file: 'land_use.geojson'   },
  { theme: 'base',           type: 'land',      file: 'land.geojson'        },
  { theme: 'transportation', type: 'segment',   file: 'segment.geojson'     },
];
for (const { theme, type, file } of duckTypes) {
  console.log(
    `COPY (SELECT * FROM read_parquet('${RELEASE}/theme=${theme}/type=${type}/*', hive_partitioning=1)` +
    ` WHERE bbox.xmin>=${W} AND bbox.xmax<=${E} AND bbox.ymin>=${S} AND bbox.ymax<=${N})` +
    ` TO '${OUT}/${file}' WITH (FORMAT GDAL, DRIVER 'GeoJSON');`,
  );
}
console.log('');
