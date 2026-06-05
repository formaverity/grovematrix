// 2D similarity transform: scene {x,z} ↔ WGS84 {lng,lat}
//
// Approach: equirectangular ENU approximation about an anchor point,
// then a 4-DOF similarity (scale + rotation + translation) solved
// via least-squares from N≥2 ground-control-point pairs.
//
// The complex-number formulation makes the least-squares linear:
//   east + i·north ≈ (ar + i·ai) · (x + i·z) + (tx + i·ty)
// giving a 4×4 normal equation solvable with Gaussian elimination.

export const ASBURY_PARK_ANCHOR = { lng: -74.0121, lat: 40.2204 };

const NORTH_M_PER_DEG = 110540;

function eastMPerDeg(lat0Deg) {
  return Math.cos((lat0Deg * Math.PI) / 180) * 111320;
}

// ── Coordinate helpers ──────────────────────────────────────────────────────

export function latLngToENU(lng, lat, anchor) {
  return {
    east: (lng - anchor.lng) * eastMPerDeg(anchor.lat),
    north: (lat - anchor.lat) * NORTH_M_PER_DEG,
  };
}

export function ENUtoLatLng(east, north, anchor) {
  return {
    lng: anchor.lng + east / eastMPerDeg(anchor.lat),
    lat: anchor.lat + north / NORTH_M_PER_DEG,
  };
}

// ── Transform application ────────────────────────────────────────────────────

// transform: { ar, ai, tx, ty, anchorLng, anchorLat }
//
// Three.js scene: +X = east, +Z = south (toward viewer when looking down).
// Geographic ENU: +east, +north. These systems have opposite handedness in the
// XZ plane, so the correct similarity is orientation-reversing:
//
//   east  = ar·x + ai·z + tx
//   north = ai·x − ar·z + ty
//
// Matrix [[ar, ai],[ai,−ar]], det = −(ar²+ai²) < 0 (reflection × rotation).
// The solver must use matching rows; worldToScene is its exact inverse.

export function sceneToWorld(x, z, transform) {
  const { ar, ai, tx, ty, anchorLng, anchorLat } = transform;
  const east  = ar * x + ai * z + tx;
  const north = ai * x - ar * z + ty;
  return ENUtoLatLng(east, north, { lng: anchorLng, lat: anchorLat });
}

export function worldToScene(lng, lat, transform) {
  const { ar, ai, tx, ty, anchorLng, anchorLat } = transform;
  const { east, north } = latLngToENU(lng, lat, { lng: anchorLng, lat: anchorLat });
  // Inverse of [[ar,ai],[ai,−ar]] = (1/−s²)·[[−ar,−ai],[−ai,ar]]
  //                               = (1/s²)·[[ar,ai],[ai,−ar]]  (same matrix!)
  const e = east - tx;
  const n = north - ty;
  const s2 = ar * ar + ai * ai;
  return {
    x: ( ar * e + ai * n) / s2,
    z: ( ai * e - ar * n) / s2,
  };
}

// ── Gaussian elimination (4×4) ───────────────────────────────────────────────

function solveLinear4(A, b) {
  const n = 4;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-14) throw new Error('Singular — add more GCPs');

    for (let row = col + 1; row < n; row++) {
      const f = M[row][col] / M[col][col];
      for (let j = col; j <= n; j++) M[row][j] -= f * M[col][j];
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

// ── Solver ───────────────────────────────────────────────────────────────────

/**
 * Solve a 2D similarity transform from GCP pairs.
 *
 * @param {Array<{scene:{x,z}, world:{lng,lat}}>} gcps  N≥2 pairs
 * @param {{lng,lat}} anchor  ENU origin (defaults to Asbury Park centroid)
 * @returns transform object ready for sceneToWorld / worldToScene
 */
export function solveTransform(gcps, anchor = null) {
  const N = gcps.length;
  if (N < 2) throw new Error('Need at least 2 GCPs');

  // Use centroid of world points as anchor for numerical stability
  const anchorLng = anchor?.lng ?? gcps.reduce((s, g) => s + g.world.lng, 0) / N;
  const anchorLat = anchor?.lat ?? gcps.reduce((s, g) => s + g.world.lat, 0) / N;
  const resolvedAnchor = { lng: anchorLng, lat: anchorLat };

  const P = gcps.map((g) => [g.scene.x, g.scene.z]);
  const Q = gcps.map((g) => {
    const { east, north } = latLngToENU(g.world.lng, g.world.lat, resolvedAnchor);
    return [east, north];
  });

  // Normal equations: M^T M θ = M^T q
  // θ = [ar, ai, tx, ty]
  // Matches orientation-reversing forward formula:
  //   east  = ar·x + ai·z + tx  →  Row 1: [x,  z, 1, 0]
  //   north = ai·x − ar·z + ty  →  Row 2: [−z, x, 0, 1]
  const AtA = Array.from({ length: 4 }, () => new Array(4).fill(0));
  const Atb = new Array(4).fill(0);

  for (let i = 0; i < N; i++) {
    const [x, z] = P[i];
    const [e, n] = Q[i];
    const rows = [
      [ x,  z, 1, 0, e],
      [-z,  x, 0, 1, n],
    ];
    for (const row of rows) {
      for (let j = 0; j < 4; j++) {
        for (let k = 0; k < 4; k++) AtA[j][k] += row[j] * row[k];
        Atb[j] += row[j] * row[4];
      }
    }
  }

  const [ar, ai, tx, ty] = solveLinear4(AtA, Atb);

  const scale = Math.sqrt(ar * ar + ai * ai);
  const angle = Math.atan2(ai, ar);

  // Per-point residuals in metres
  let rss = 0;
  const perPointResiduals = P.map((p, i) => {
    const ePred = ar * p[0] + ai * p[1] + tx;   // orientation-reversing formula
    const nPred = ai * p[0] - ar * p[1] + ty;
    const r = Math.sqrt((ePred - Q[i][0]) ** 2 + (nPred - Q[i][1]) ** 2);
    rss += r * r;
    return r;
  });
  const rmsM = Math.sqrt(rss / N);

  return {
    ar,
    ai,
    tx,
    ty,
    scale,
    angle,
    anchorLng,
    anchorLat,
    rmsM,
    perPointResiduals,
    gcps,
    solvedAt: new Date().toISOString(),
  };
}

// ── 3D city helpers ───────────────────────────────────────────────────────────

// Inverse of latLngToENU (ENUtoLatLng was private; export under the canonical name).
export const enuToLatLng = ENUtoLatLng;

/**
 * Convert lng/lat to ENU-based Three.js ground coordinates.
 * Axis convention (Three.js Y-up, Z-toward-viewer / Z-south):
 *   X = ENU east
 *   Y = 0  (elevation — set by caller)
 *   Z = −ENU north
 *
 * Returns a plain {x,y,z}. Caller does: new THREE.Vector3(x, y, z).
 */
export function lngLatToEnuCoords(lng, lat, anchor) {
  const { east, north } = latLngToENU(lng, lat, anchor);
  return { x: east, y: 0, z: -north };
}

/**
 * Build the 4×4 similarity matrix mapping centred survey-scene coords
 * (scene units) → Three.js ENU world coords (metres).
 *
 *   X = ar·x + ai·z + tx     (east)
 *   Y = scale·y               (elevation, same scale as horizontal)
 *   Z = −ai·x + ar·z − ty    (−north)
 *
 * @param {object}   transform  Saved georeference object (ar, ai, tx, ty, scale)
 * @param {Function} Matrix4    THREE.Matrix4 constructor (kept separate to avoid
 *                              importing three inside a pure-math module)
 */
export function makeSceneToEnuMatrix(transform, Matrix4) {
  const { ar, ai, scale, tx, ty } = transform;
  // Matrix4.set() arguments are in row-major order
  return new Matrix4().set(
     ar,    0,  ai,  tx,
      0, scale,   0,   0,
    -ai,    0,  ar, -ty,
      0,    0,   0,   1,
  );
}
