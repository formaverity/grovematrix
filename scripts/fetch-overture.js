#!/usr/bin/env node
// fetch-overture.js
//
// Runs the overturemaps CLI downloads for the derived bbox.
// Requires: pip install overturemaps
//
// Usage:
//   node scripts/fetch-overture.js
//   node scripts/fetch-overture.js --bbox=-74.066,-74.062,40.328,40.338
//
// If --bbox is omitted, the bbox is auto-derived from tree-markers.json.
// Creates public/data/overture/_raw/ if it doesn't exist.

'use strict';

const fs     = require('fs');
const path   = require('path');
const { execSync } = require('child_process');

// ── Resolve bbox ──────────────────────────────────────────────────────────────

const PAD = 0.004;

function deriveBbox() {
  const markers = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'tree-markers.json'), 'utf8'),
  );
  const geo = markers.filter((m) => m.lng != null && m.lat != null);
  if (!geo.length) throw new Error('No georeferenced markers. Run backfill first.');
  const lngs = geo.map((m) => m.lng);
  const lats  = geo.map((m) => m.lat);
  return [
    +(Math.min(...lngs) - PAD).toFixed(7),
    +(Math.min(...lats) - PAD).toFixed(7),
    +(Math.max(...lngs) + PAD).toFixed(7),
    +(Math.max(...lats) + PAD).toFixed(7),
  ].join(',');
}

const bboxArg = process.argv.find((a) => a.startsWith('--bbox='));
const bbox    = bboxArg ? bboxArg.split('=')[1] : deriveBbox();

console.log(`Fetching bbox: ${bbox}\n`);

// ── Ensure output directory ───────────────────────────────────────────────────

const rawDir = path.join(__dirname, '..', 'public', 'data', 'overture', '_raw');
fs.mkdirSync(rawDir, { recursive: true });

// ── Resolve the overturemaps command ─────────────────────────────────────────
// `pip install overturemaps` puts the exe in Python's Scripts dir which may
// not be on PATH. Prefer invoking it as a module so PATH doesn't matter.

function findOverturemaps() {
  const candidates = [
    'python -m overturemaps',
    'python3 -m overturemaps',
    'py -m overturemaps',     // Windows py launcher
    'overturemaps',           // if Scripts dir IS on PATH
  ];
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --help`, { stdio: 'pipe' });
      return cmd;
    } catch {
      // try next
    }
  }
  return null;
}

const omCmd = findOverturemaps();
if (!omCmd) {
  console.error('overturemaps not found. Install it with:');
  console.error('  pip install overturemaps');
  console.error('Then re-run this script.');
  process.exit(1);
}
console.log(`Using: ${omCmd}\n`);

// ── Downloads ─────────────────────────────────────────────────────────────────

const downloads = [
  { type: 'building', file: 'buildings.geojson'  },
  { type: 'land_use', file: 'land_use.geojson'   },
  { type: 'land',     file: 'land.geojson'        },
  { type: 'segment',  file: 'segment.geojson'     },
];

for (const { type, file } of downloads) {
  const out = path.join(rawDir, file);
  const cmd = `${omCmd} download --bbox=${bbox} -f geojson --type=${type} -o "${out}"`;
  console.log(`→ ${type}…`);
  try {
    execSync(cmd, { stdio: 'inherit' });
    const stat = fs.statSync(out);
    console.log(`  ✓ ${file} (${(stat.size / 1024).toFixed(0)} KB)\n`);
  } catch (err) {
    console.error(`  ✗ Failed: ${err.message}\n`);
  }
}

console.log('Done. Run: node scripts/classify-overture.js');
