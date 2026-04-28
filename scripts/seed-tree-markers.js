#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Sample species data suitable for New Jersey urban conditions
const SPECIES_DATA = [
  { common_name: 'Red Maple', species: 'Acer rubrum' },
  { common_name: 'London Plane', species: 'Platanus × acerifolia' },
  { common_name: 'Honey Locust', species: 'Gleditsia triacanthos' },
  { common_name: 'Pin Oak', species: 'Quercus palustris' },
  { common_name: 'Zelkova', species: 'Zelkova serrata' },
  { common_name: 'Red Oak', species: 'Quercus rubra' },
  { common_name: 'Serviceberry', species: 'Amelanchier canadensis' },
  { common_name: 'Sweetgum', species: 'Liquidambar styraciflua' },
];

// Condition options
const CONDITIONS = [
  'Good',
  'Fair',
  'Young / Establishing',
  'Needs verification',
  'Unknown'
];

// Generate deterministic canopy radius based on index (8-26 feet)
function getCanopyRadius(index) {
  return 8 + (index % 19); // 8-26 range
}

// Estimate benefits for placeholder analytics
function estimateBenefits(radius) {
  const shadeSqft = Math.round(Math.PI * radius * radius);
  const annualStormwaterGal = Math.round(shadeSqft * 1.25);
  const annualCarbonLb = Math.round(radius * 2.8);
  const carbonStoredLb = Math.round(radius * radius * 1.7);
  const coolingScore = Math.min(100, Math.round(35 + radius * 2.4));

  return {
    shadeSqft,
    annualStormwaterGal,
    annualCarbonLb,
    carbonStoredLb,
    coolingScore
  };
}

// Generate deterministic species based on index
function getSpecies(index) {
  return SPECIES_DATA[index % SPECIES_DATA.length];
}

// Generate deterministic condition based on index
function getCondition(index) {
  return CONDITIONS[index % CONDITIONS.length];
}

async function seedTreeMarkers() {
  try {
    // Load environment variables
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase environment variables. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
    }

    // Initialize Supabase client
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Read tree markers JSON
    const markersPath = path.join(__dirname, '..', 'public', 'data', 'tree-markers.json');
    const markersData = JSON.parse(fs.readFileSync(markersPath, 'utf8'));

    console.log(`📖 Read ${markersData.length} markers from tree-markers.json`);

    let upsertedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Process each marker
    for (let i = 0; i < markersData.length; i++) {
      const marker = markersData[i];
      const markerCode = marker.id || marker.marker_code;

      if (!markerCode) {
        console.error(`❌ Marker at index ${i} missing id or marker_code`);
        errorCount++;
        continue;
      }

      try {
        // Check if marker already exists and is verified
        const { data: existingMarker, error: fetchError } = await supabase
          .from('tree_markers')
          .select('verified')
          .eq('marker_code', markerCode)
          .single();

        if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = no rows returned
          console.error(`❌ Error checking existing marker ${markerCode}:`, fetchError.message);
          errorCount++;
          continue;
        }

        // Skip if marker exists and is verified
        if (existingMarker && existingMarker.verified === true) {
          console.log(`⏭️  Skipping verified marker ${markerCode}`);
          skippedCount++;
          continue;
        }

        // Generate sample data
        const speciesData = getSpecies(i);
        const canopyRadius = getCanopyRadius(i);
        const condition = getCondition(i);
        const benefits = estimateBenefits(canopyRadius);

        const markerData = {
          marker_code: markerCode,
          x: marker.x,
          y: marker.y,
          z: marker.z,
          common_name: speciesData.common_name,
          species: speciesData.species,
          canopy_radius_ft: canopyRadius,
          condition: condition,
          notes: 'Sample placeholder record generated from initial point-cloud marker placement. Requires field verification.',
          verified: false,
          shade_sqft: benefits.shadeSqft,
          annual_stormwater_gal: benefits.annualStormwaterGal,
          annual_carbon_lb: benefits.annualCarbonLb,
          carbon_stored_lb: benefits.carbonStoredLb,
          cooling_score: benefits.coolingScore,
          data_status: 'sample',
          updated_at: new Date().toISOString()
        };

        // Upsert the marker
        const { error: upsertError } = await supabase
          .from('tree_markers')
          .upsert(markerData, { onConflict: 'marker_code' });

        if (upsertError) {
          console.error(`❌ Error upserting marker ${markerCode}:`, upsertError.message);
          errorCount++;
        } else {
          console.log(`✅ Upserted marker ${markerCode} (${speciesData.common_name})`);
          upsertedCount++;
        }

      } catch (error) {
        console.error(`❌ Unexpected error processing marker ${markerCode}:`, error.message);
        errorCount++;
      }
    }

    // Summary
    console.log('\n📊 Seeding Summary:');
    console.log(`   Markers read: ${markersData.length}`);
    console.log(`   Successfully upserted: ${upsertedCount}`);
    console.log(`   Skipped (verified): ${skippedCount}`);
    console.log(`   Errors: ${errorCount}`);

    if (errorCount > 0) {
      process.exit(1);
    }

  } catch (error) {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the seeding function
seedTreeMarkers();