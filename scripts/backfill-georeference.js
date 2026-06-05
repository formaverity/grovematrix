#!/usr/bin/env node
// backfill-georeference.js
//
// Once the grove_georeference SQL migration has been run AND a transform has
// been solved in the Calibrator, this script:
//   1. Reads the transform from localStorage export or a local JSON file.
//   2. Computes {lng, lat} for every marker from its {x, z} scene coords.
//   3. Upserts lng/lat back to Supabase tree_markers.
//   4. Rewrites public/data/tree-markers.json with lng/lat so the JSON
//      fallback stays in sync with Supabase.
//
// Usage:
//   node scripts/backfill-georeference.js --transform ./grove-georeference.json
//
// To export the transform from the browser:
//   copy localStorage.getItem('grove-georeference') into grove-georeference.json
//
// Prerequisites: run sql/2026-06_add-georeference.sql first.

'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ── Auto-load .env.local if env vars aren't already set ─────────────────────
(function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  // Strip BOM and normalise line endings before parsing
  const raw = fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '').replace(/\r/g, '');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    // Don't overwrite vars that were explicitly set in the environment
    if (key && val && !process.env[key]) process.env[key] = val;
  }
})();

// ── Inline transform math (mirrors src/lib/geoTransform.js) ─────────────────

const NORTH_M_PER_DEG = 110540;

function eastMPerDeg(lat0) {
  return Math.cos((lat0 * Math.PI) / 180) * 111320;
}

function sceneToWorld(x, z, t) {
  // Orientation-reversing similarity — matches geoTransform.js exactly.
  // +Z is south in Three.js plan view, hence the sign flip vs the naive formula.
  const east  = t.ar * x + t.ai * z + t.tx;
  const north = t.ai * x - t.ar * z + t.ty;
  const lng = t.anchorLng + east / eastMPerDeg(t.anchorLat);
  const lat = t.anchorLat + north / NORTH_M_PER_DEG;
  return { lng, lat };
}

// ── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const transformIdx = args.indexOf('--transform');
  if (transformIdx === -1 || !args[transformIdx + 1]) {
    console.error(
      'Usage: node scripts/backfill-georeference.js --transform <path-to-transform.json>',
    );
    console.error('');
    console.error('Export the transform from the browser console:');
    console.error("  copy the value of localStorage.getItem('grove-georeference')");
    console.error('  into a local JSON file and pass its path here.');
    process.exit(1);
  }
  return { transformPath: args[transformIdx + 1] };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { transformPath } = parseArgs();

  // 1. Load transform
  const transformRaw = fs.readFileSync(path.resolve(transformPath), 'utf8');
  const transform = JSON.parse(transformRaw);

  const required = ['ar', 'ai', 'tx', 'ty', 'anchorLng', 'anchorLat'];
  for (const key of required) {
    if (transform[key] == null) {
      console.error(`Transform JSON is missing required field: ${key}`);
      process.exit(1);
    }
  }

  console.log(
    `Transform loaded: scale=${transform.scale?.toFixed(5)}, ` +
      `rms=${transform.rmsM?.toFixed(3)} m, anchor=(${transform.anchorLat}, ${transform.anchorLng})`,
  );

  // 2. Init Supabase
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY env vars.');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 3. Fetch all markers from Supabase
  const { data: rows, error: fetchError } = await supabase
    .from('tree_markers')
    .select('marker_code, x, z');

  if (fetchError) {
    console.error('Supabase fetch failed:', fetchError.message);
    process.exit(1);
  }

  console.log(`Fetched ${rows.length} markers from Supabase.`);

  // 4. Compute lng/lat and upsert
  let updated = 0;
  let errors = 0;

  for (const row of rows) {
    const x = Number(row.x);
    const z = Number(row.z);

    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      console.warn(`Skipping ${row.marker_code}: invalid x/z (${row.x}, ${row.z})`);
      errors++;
      continue;
    }

    const { lng, lat } = sceneToWorld(x, z, transform);
    const { error: upsertError } = await supabase
      .from('tree_markers')
      .update({ lng, lat, geo_source: 'derived' })
      .eq('marker_code', row.marker_code);

    if (upsertError) {
      console.error(`Error updating ${row.marker_code}:`, upsertError.message);
      errors++;
    } else {
      updated++;
      if (updated % 20 === 0) console.log(`  Updated ${updated}/${rows.length}...`);
    }
  }

  console.log(`\nSupabase: updated ${updated}, errors ${errors}.`);

  // 5. Rewrite public/data/tree-markers.json with lng/lat
  const jsonPath = path.join(__dirname, '..', 'public', 'data', 'tree-markers.json');
  let jsonMarkers;
  try {
    jsonMarkers = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    console.warn('Could not read tree-markers.json, skipping JSON update:', err.message);
    return;
  }

  const updated_json = jsonMarkers.map((m) => {
    const x = Number(m.x);
    const z = Number(m.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return m;
    const { lng, lat } = sceneToWorld(x, z, transform);
    return { ...m, lng: Number(lng.toFixed(8)), lat: Number(lat.toFixed(8)), geo_source: 'derived' };
  });

  fs.writeFileSync(jsonPath, JSON.stringify(updated_json, null, 2));
  console.log(`JSON fallback rewritten: ${jsonPath}`);

  // 6. Optionally persist transform to Supabase grove_georeference table
  console.log('\nAttempting to persist transform to grove_georeference table...');
  const { error: deactivateError } = await supabase
    .from('grove_georeference')
    .update({ is_active: false })
    .eq('is_active', true);

  if (deactivateError) {
    console.warn(
      'Could not deactivate old transform (table may not exist yet — run the SQL migration first):',
      deactivateError.message,
    );
  } else {
    const { error: insertError } = await supabase.from('grove_georeference').insert({
      is_active: true,
      ar: transform.ar,
      ai: transform.ai,
      tx: transform.tx,
      ty: transform.ty,
      scale: transform.scale,
      angle_rad: transform.angle,
      anchor_lng: transform.anchorLng,
      anchor_lat: transform.anchorLat,
      rms_m: transform.rmsM,
      gcp_json: transform.gcps,
      solved_at: transform.solvedAt || new Date().toISOString(),
    });

    if (insertError) {
      console.warn('Could not insert transform to grove_georeference:', insertError.message);
    } else {
      console.log('Transform persisted to grove_georeference table.');
    }
  }

  console.log('\nBackfill complete.');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
