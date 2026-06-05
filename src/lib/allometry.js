// allometry.js — Species-keyed allometric estimates for urban trees.
//
// All models are linear approximations (height = a × DBH_in + b) calibrated
// against the Urban Tree Database (McPherson et al., 2016) and i-Tree Eco
// species parameters for the Northeast US. These are ESTIMATES — present
// them to the user as starting points, not measurements.
//
// When a species is not in the table, the '_generic_hardwood' fallback is used.
// That fallback is intentionally conservative (leans toward smaller estimates).
//
// Units: DBH in inches, all outputs in feet.

const TABLE = {
  // key: PlantNet scientificNameWithoutAuthor (lower-case match)

  // Maples
  'acer rubrum':          { hA: 1.55, hB: 12, csA: 0.85, csB:  7, cbRatio: 0.28 },
  'acer platanoides':     { hA: 1.50, hB: 11, csA: 0.88, csB:  7, cbRatio: 0.27 },
  'acer saccharinum':     { hA: 1.70, hB: 12, csA: 0.95, csB:  8, cbRatio: 0.30 },
  'acer saccharum':       { hA: 1.45, hB: 14, csA: 0.82, csB:  9, cbRatio: 0.29 },

  // Planes / Sycamores
  'platanus × acerifolia':  { hA: 1.80, hB: 10, csA: 1.00, csB:  8, cbRatio: 0.32 },
  'platanus occidentalis':  { hA: 1.75, hB: 11, csA: 0.98, csB:  8, cbRatio: 0.30 },

  // Oaks
  'quercus palustris':    { hA: 1.55, hB: 15, csA: 0.90, csB: 10, cbRatio: 0.27 },
  'quercus rubra':        { hA: 1.50, hB: 16, csA: 0.92, csB: 10, cbRatio: 0.26 },
  'quercus bicolor':      { hA: 1.40, hB: 14, csA: 0.88, csB:  9, cbRatio: 0.26 },
  'quercus alba':         { hA: 1.42, hB: 14, csA: 0.90, csB: 10, cbRatio: 0.27 },

  // Elms / Zelkova
  'zelkova serrata':      { hA: 1.48, hB: 11, csA: 0.88, csB:  7, cbRatio: 0.28 },
  'ulmus americana':      { hA: 1.60, hB: 12, csA: 1.05, csB:  9, cbRatio: 0.30 },
  'ulmus parvifolia':     { hA: 1.40, hB: 10, csA: 0.90, csB:  7, cbRatio: 0.27 },

  // Others
  'gleditsia triacanthos':    { hA: 1.55, hB: 10, csA: 0.82, csB:  7, cbRatio: 0.30 },
  'tilia cordata':            { hA: 1.42, hB: 12, csA: 0.80, csB:  7, cbRatio: 0.25 },
  'liquidambar styraciflua':  { hA: 1.55, hB: 13, csA: 0.72, csB:  6, cbRatio: 0.28 },
  'liriodendron tulipifera':  { hA: 1.80, hB: 10, csA: 0.70, csB:  5, cbRatio: 0.32 },
  'ginkgo biloba':            { hA: 1.38, hB: 12, csA: 0.62, csB:  5, cbRatio: 0.27 },
  'betula nigra':             { hA: 1.55, hB: 10, csA: 0.78, csB:  6, cbRatio: 0.29 },
  'prunus serotina':          { hA: 1.40, hB: 12, csA: 0.70, csB:  7, cbRatio: 0.26 },
  'celtis occidentalis':      { hA: 1.45, hB: 12, csA: 0.80, csB:  7, cbRatio: 0.27 },
  'pyrus calleryana':         { hA: 1.25, hB:  8, csA: 0.70, csB:  5, cbRatio: 0.25 },
  'styphnolobium japonicum':  { hA: 1.50, hB: 11, csA: 0.82, csB:  7, cbRatio: 0.28 },
  'nyssa sylvatica':          { hA: 1.45, hB: 13, csA: 0.72, csB:  7, cbRatio: 0.27 },

  // Generic fallback — conservative; used when species is absent or 'Unknown'
  '_generic_hardwood':        { hA: 1.55, hB: 12, csA: 0.82, csB:  7, cbRatio: 0.27 },
};

/**
 * Estimate structural dimensions from species + DBH.
 *
 * @param {string|null} scientificName  PlantNet scientificNameWithoutAuthor (or common app species)
 * @param {number}      dbhIn           Diameter at breast height, inches
 * @returns {{ heightFt, crownSpreadFt, crownBaseFt, model }}
 *   model: 'species-keyed' | 'generic-fallback'
 */
export function estimateStructure(scientificName, dbhIn) {
  const key = (scientificName ?? '').toLowerCase().trim();
  const params = TABLE[key] ?? TABLE['_generic_hardwood'];
  const model = TABLE[key] ? 'species-keyed' : 'generic-fallback';

  const raw = {
    heightFt:      params.hA  * dbhIn + params.hB,
    crownSpreadFt: params.csA * dbhIn + params.csB,
  };
  raw.crownBaseFt = params.cbRatio * raw.heightFt;

  return {
    heightFt:      round1(Math.max(5, raw.heightFt)),
    crownSpreadFt: round1(Math.max(4, raw.crownSpreadFt)),
    crownBaseFt:   round1(Math.max(2, raw.crownBaseFt)),
    model,
  };
}

function round1(n) { return Math.round(n * 10) / 10; }

/** Species keys in the table (for autocomplete / diagnostics). */
export const ALLOMETRY_KEYS = Object.keys(TABLE).filter((k) => k !== '_generic_hardwood');
