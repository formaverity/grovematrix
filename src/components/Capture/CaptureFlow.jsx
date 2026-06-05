import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useGroveStore, selectSelectedMarker } from '../../store/useGroveStore.js';
import { estimateStructure } from '../../lib/allometry.js';
import njPriorData from '../../data/nj-street-trees.json';

// ── NJ prior re-rank ──────────────────────────────────────────────────────────

const NJ_PRIOR = new Map(
  njPriorData.species.map((s) => [s.scientific.toLowerCase(), s.boost]),
);
const UNLISTED_FACTOR = 0.80;

function applyNjPrior(results) {
  return results
    .map((r) => {
      const key    = r.species.scientificNameWithoutAuthor?.toLowerCase() ?? '';
      const boost  = NJ_PRIOR.get(key) ?? UNLISTED_FACTOR;
      return { ...r, adjustedScore: Math.min(1, r.score * boost), inNjPrior: NJ_PRIOR.has(key) };
    })
    .sort((a, b) => b.adjustedScore - a.adjustedScore);
}

// ── Image compression (Canvas → base64 JPEG) ─────────────────────────────────

function compressImage(file, maxPx = 900, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale  = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve({
            data:     reader.result.split(',')[1],
            mimeType: 'image/jpeg',
            blob,
          });
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ── Organ options ─────────────────────────────────────────────────────────────

const ORGANS = [
  { value: 'leaf',   label: 'Leaf',   tip: 'Best for ID' },
  { value: 'flower', label: 'Flower', tip: 'Best of all' },
  { value: 'fruit',  label: 'Fruit',  tip: 'Great for ID' },
  { value: 'bark',   label: 'Bark',   tip: 'Low accuracy' },
  { value: 'auto',   label: 'Auto',   tip: '' },
];

// ── Step components ───────────────────────────────────────────────────────────

function PhotosStep({ photos, onAddFiles, onRemove, onOrganChange, onSkipToStructure }) {
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  const handleFiles = useCallback((files) => {
    const valid = Array.from(files).slice(0, 5 - photos.length);
    if (valid.length) onAddFiles(valid);
  }, [photos.length, onAddFiles]);

  return (
    <div className="cap-step">
      <p className="cap-guidance">
        <strong>Leaf close-ups identify best.</strong> Add bark or whole-tree as backup.
        Flower &gt; fruit &gt; leaf &gt; bark for accuracy.
      </p>

      <div className="cap-photo-grid">
        {photos.map((p, i) => (
          <div key={i} className="cap-photo-card">
            <img src={p.preview} alt={`capture ${i + 1}`} className="cap-thumb" />
            <select
              className="cap-organ-select"
              value={p.organ}
              onChange={(e) => onOrganChange(i, e.target.value)}
            >
              {ORGANS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}{o.tip ? ` — ${o.tip}` : ''}</option>
              ))}
            </select>
            <button type="button" className="cap-photo-remove" onClick={() => onRemove(i)}>×</button>
          </div>
        ))}

        {photos.length < 5 && (
          <div className="cap-add-photo">
            {/* Camera input — opens camera directly on mobile */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={(e) => handleFiles(e.target.files)}
            />
            {/* Gallery input — file picker */}
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => handleFiles(e.target.files)}
            />
            <button type="button" className="cap-add-btn" onClick={() => cameraRef.current?.click()}>
              📷 Camera
            </button>
            <button type="button" className="cap-add-btn" onClick={() => galleryRef.current?.click()}>
              📁 Gallery
            </button>
          </div>
        )}
      </div>

      <p className="cap-count">{photos.length} / 5 images</p>

      <button type="button" className="cap-link" onClick={onSkipToStructure}>
        Skip species ID → enter manually
      </button>
    </div>
  );
}

function SpeciesStep({
  identifying, identifyError, quotaRemaining,
  candidates, selectedIdx, onSelectIdx,
  useManual, onToggleManual,
  manualScientific, manualCommon,
  onManualScientificChange, onManualCommonChange,
}) {
  if (identifying) {
    return (
      <div className="cap-step cap-step-center">
        <div className="cap-spinner" aria-label="Identifying…" />
        <p className="cap-status">Identifying via PlantNet…</p>
        {quotaRemaining != null && (
          <p className="cap-quota">{quotaRemaining} identifications remaining today</p>
        )}
      </div>
    );
  }

  if (identifyError) {
    return (
      <div className="cap-step">
        <p className="cap-error">{identifyError}</p>
        <p className="cap-hint">Enter species manually below, or go back and try again.</p>
        <ManualEntry
          scientific={manualScientific} common={manualCommon}
          onScientific={onManualScientificChange} onCommon={onManualCommonChange}
        />
      </div>
    );
  }

  return (
    <div className="cap-step">
      {quotaRemaining != null && (
        <p className="cap-quota">{quotaRemaining} PlantNet IDs remaining today</p>
      )}

      <div className="cap-prior-note">
        🌿 Results re-ranked with Asbury Park / NJ street-tree prior.
        <span className="cap-prior-badge">NJ ↑</span> = boosted species.
        Raw score shown in parentheses.
      </div>

      <div className="cap-candidates">
        {candidates.slice(0, 6).map((c, i) => (
          <button
            key={i}
            type="button"
            className={`cap-candidate${i === selectedIdx && !useManual ? ' is-selected' : ''}`}
            onClick={() => { onSelectIdx(i); if (useManual) onToggleManual(); }}
          >
            <div className="cap-cand-scores">
              <span className="cap-adj-score">{Math.round(c.adjustedScore * 100)}%</span>
              <span className="cap-raw-score">({Math.round(c.score * 100)}% raw)</span>
              {c.inNjPrior && <span className="cap-prior-badge">NJ ↑</span>}
            </div>
            <div className="cap-cand-names">
              <span className="cap-sci">{c.species.scientificNameWithoutAuthor}</span>
              <span className="cap-common">{c.species.commonNames?.[0] ?? '—'}</span>
              <span className="cap-family">{c.species.family}</span>
            </div>
            {c.images?.length > 0 && (
              <div className="cap-ref-images">
                {c.images.map((img, j) => img.url && (
                  <img key={j} src={img.url} alt={img.organ} className="cap-ref-img" loading="lazy" />
                ))}
              </div>
            )}
          </button>
        ))}
      </div>

      <details className="cap-manual-details">
        <summary
          className="cap-link"
          onClick={(e) => { e.preventDefault(); onToggleManual(); }}
        >
          {useManual ? '✓ Manual entry active' : 'None of these — enter manually'}
        </summary>
        {useManual && (
          <ManualEntry
            scientific={manualScientific} common={manualCommon}
            onScientific={onManualScientificChange} onCommon={onManualCommonChange}
          />
        )}
      </details>
    </div>
  );
}

function ManualEntry({ scientific, common, onScientific, onCommon }) {
  return (
    <div className="cap-manual-entry">
      <label className="cap-field-label">
        Scientific name
        <input
          type="text"
          className="cap-input"
          value={scientific}
          onChange={(e) => onScientific(e.target.value)}
          placeholder="e.g. Acer rubrum"
        />
      </label>
      <label className="cap-field-label">
        Common name
        <input
          type="text"
          className="cap-input"
          value={common}
          onChange={(e) => onCommon(e.target.value)}
          placeholder="e.g. Red Maple"
        />
      </label>
    </div>
  );
}

function StructureStep({
  speciesForAllometry,
  dbh, onDbh,
  heightFt, onHeightFt,
  crownSpreadFt, onCrownSpreadFt,
  crownBaseFt, onCrownBaseFt,
  structureEdited,
  onRefreshAllometry,
}) {
  return (
    <div className="cap-step">
      <p className="cap-guidance">
        <strong>DBH</strong> (diameter at breast height, 4.5 ft / 1.4 m above ground) is the
        primary field measurement. Height and crown are allometric estimates — edit freely.
      </p>

      <label className="cap-field-label cap-field-required">
        DBH (inches) — measured
        <input
          type="number"
          className="cap-input"
          value={dbh}
          onChange={(e) => onDbh(e.target.value)}
          placeholder="e.g. 12"
          min="0"
          step="0.5"
        />
      </label>

      <div className="cap-allometry-header">
        <span>Allometric estimates{structureEdited ? ' (edited)' : ''}</span>
        {dbh && (
          <button type="button" className="cap-link" onClick={onRefreshAllometry}>
            ↺ Recalculate from DBH
          </button>
        )}
      </div>
      <p className="cap-allometry-note">
        Model: {speciesForAllometry ?? 'generic hardwood fallback'} · Edit any value to override.
      </p>

      <div className="cap-struct-row">
        <label className="cap-field-label">
          Height (ft) ~
          <input type="number" className="cap-input" value={heightFt}
            onChange={(e) => onHeightFt(e.target.value)} min="0" step="1" />
        </label>
        <label className="cap-field-label">
          Crown spread (ft) ~
          <input type="number" className="cap-input" value={crownSpreadFt}
            onChange={(e) => onCrownSpreadFt(e.target.value)} min="0" step="1" />
        </label>
        <label className="cap-field-label">
          Crown base ht (ft) ~
          <input type="number" className="cap-input" value={crownBaseFt}
            onChange={(e) => onCrownBaseFt(e.target.value)} min="0" step="1" />
        </label>
      </div>
    </div>
  );
}

function ReviewStep({ marker, species, commonName, dbh, heightFt, crownSpreadFt, speciesSource, structureSource }) {
  const status = (species && species !== 'Unknown' && dbh) ? 'verified'
    : (species && species !== 'Unknown') ? 'partial' : 'sample';

  return (
    <div className="cap-step">
      <div className="cap-review-card">
        <div className="cap-review-row">
          <span className="cap-review-label">Marker</span>
          <span>{marker?.id ?? '—'}</span>
        </div>
        <div className="cap-review-row">
          <span className="cap-review-label">Species</span>
          <span>
            <em>{species}</em>
            {commonName && commonName !== species && ` (${commonName})`}
            <span className="cap-source-badge">{speciesSource}</span>
          </span>
        </div>
        {dbh && (
          <div className="cap-review-row">
            <span className="cap-review-label">DBH</span>
            <span>{dbh}&Prime;</span>
          </div>
        )}
        {heightFt && (
          <div className="cap-review-row">
            <span className="cap-review-label">Height ~</span>
            <span>{heightFt} ft <span className="cap-source-badge">{structureSource}</span></span>
          </div>
        )}
        {crownSpreadFt && (
          <div className="cap-review-row">
            <span className="cap-review-label">Crown spread ~</span>
            <span>{crownSpreadFt} ft</span>
          </div>
        )}
        <div className="cap-review-row">
          <span className="cap-review-label">Status</span>
          <span className={`cap-status-badge cap-status-${status}`}>{status}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main capture flow ─────────────────────────────────────────────────────────

const STEPS = ['photos', 'species', 'structure', 'review'];
const STEP_LABELS = { photos: 'Photos', species: 'Species', structure: 'Structure', review: 'Review' };

export function CaptureFlow() {
  const captureMarkerId    = useGroveStore((s) => s.captureMarkerId);
  const closeCapture       = useGroveStore((s) => s.closeCapture);
  const characterizeMarker = useGroveStore((s) => s.characterizeMarker);
  const marker = useGroveStore((s) =>
    s.captureMarkerId ? s.markers.find((m) => m.id === s.captureMarkerId) ?? null : null
  );

  const [step,  setStep]  = useState('photos');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Photos
  const [photos, setPhotos] = useState([]); // [{file, organ, preview}]

  // Species
  const [identifying,   setIdentifying]   = useState(false);
  const [identifyError, setIdentifyError] = useState(null);
  const [quotaRemaining, setQuotaRemaining] = useState(null);
  const [candidates,    setCandidates]    = useState([]);
  const [selectedIdx,   setSelectedIdx]   = useState(0);
  const [useManual,     setUseManual]     = useState(false);
  const [manualSci,     setManualSci]     = useState('');
  const [manualCommon,  setManualCommon]  = useState('');
  const [rawPlantnet,   setRawPlantnet]   = useState(null);

  // Structure
  const [dbh,          setDbh]          = useState('');
  const [heightFt,     setHeightFt]     = useState('');
  const [crownSpreadFt, setCrownSpreadFt] = useState('');
  const [crownBaseFt,  setCrownBaseFt]  = useState('');
  const [structureEdited, setStructureEdited] = useState(false);

  // Reset when a new marker is opened
  useEffect(() => {
    if (!captureMarkerId) return;
    setStep('photos');
    setPhotos([]);
    setIdentifying(false);
    setIdentifyError(null);
    setQuotaRemaining(null);
    setCandidates([]);
    setSelectedIdx(0);
    setUseManual(false);
    setManualSci('');
    setManualCommon('');
    setRawPlantnet(null);
    setDbh('');
    setHeightFt('');
    setCrownSpreadFt('');
    setCrownBaseFt('');
    setStructureEdited(false);
    setSaving(false);
    setSaveError(null);
  }, [captureMarkerId]);

  if (!captureMarkerId || !marker) return null;

  // ── Derived species for display / allometry ─────────────────────────────────

  const resolvedSpecies = useManual
    ? manualSci || 'Unknown'
    : candidates[selectedIdx]?.species?.scientificNameWithoutAuthor ?? 'Unknown';

  const resolvedCommon = useManual
    ? manualCommon
    : candidates[selectedIdx]?.species?.commonNames?.[0] ?? '';

  const resolvedConfidence = useManual
    ? null
    : candidates[selectedIdx]?.adjustedScore ?? null;

  const resolvedSpeciesSource = useManual ? 'manual' : 'plantnet';

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAddFiles = (files) => {
    const next = files.slice(0, 5 - photos.length).map((f) => ({
      file: f,
      organ: 'leaf',
      preview: URL.createObjectURL(f),
    }));
    setPhotos((p) => [...p, ...next]);
  };

  const handleRemovePhoto = (idx) => {
    setPhotos((p) => {
      URL.revokeObjectURL(p[idx].preview);
      return p.filter((_, i) => i !== idx);
    });
  };

  const handleOrganChange = (idx, organ) => {
    setPhotos((p) => p.map((ph, i) => i === idx ? { ...ph, organ } : ph));
  };

  const handleIdentify = async () => {
    setIdentifying(true);
    setIdentifyError(null);

    try {
      const compressed = await Promise.all(photos.map((p) => compressImage(p.file)));

      const body = {
        images: compressed.map((c, i) => ({
          data:     c.data,
          mimeType: c.mimeType,
          organ:    photos[i].organ,
        })),
        nbResults: 8,
      };

      const res = await fetch('/api/identify-species', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      const json = await res.json();

      if (json.remainingIdentificationRequests != null) {
        setQuotaRemaining(json.remainingIdentificationRequests);
      }

      if (res.status === 429 || json.error === 'quota_exceeded') {
        setIdentifyError(json.message ?? 'Daily quota reached. Enter species manually.');
        setUseManual(true);
        setStep('species');
        return;
      }

      if (!res.ok) {
        setIdentifyError(json.message ?? `Error ${res.status}. Enter species manually.`);
        setUseManual(true);
        setStep('species');
        return;
      }

      setRawPlantnet(json);
      const ranked = applyNjPrior(json.results ?? []);
      setCandidates(ranked);
      setSelectedIdx(0);
      setStep('species');

    } catch (err) {
      setIdentifyError(`Could not reach identification service (${err.message}). Enter manually.`);
      setUseManual(true);
      setStep('species');
    } finally {
      setIdentifying(false);
    }
  };

  const refreshAllometry = () => {
    if (!dbh) return;
    const est = estimateStructure(resolvedSpecies, Number(dbh));
    setHeightFt(String(est.heightFt));
    setCrownSpreadFt(String(est.crownSpreadFt));
    setCrownBaseFt(String(est.crownBaseFt));
    setStructureEdited(false);
  };

  // Auto-fill allometry when arriving at structure step with a DBH or species ready
  const handleToStructure = () => {
    setStep('structure');
    if (dbh) {
      const est = estimateStructure(resolvedSpecies, Number(dbh));
      setHeightFt((h) => h || String(est.heightFt));
      setCrownSpreadFt((c) => c || String(est.crownSpreadFt));
      setCrownBaseFt((cb) => cb || String(est.crownBaseFt));
    }
  };

  const handleDbhChange = (v) => {
    setDbh(v);
    if (v && !structureEdited) {
      const est = estimateStructure(resolvedSpecies, Number(v));
      setHeightFt(String(est.heightFt));
      setCrownSpreadFt(String(est.crownSpreadFt));
      setCrownBaseFt(String(est.crownBaseFt));
    }
  };

  const makeStructureEdited = (setter) => (v) => {
    setter(v);
    setStructureEdited(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);

    const captureJson = {
      source:     'grovematrix-capture',
      timestamp:  new Date().toISOString(),
      images:     photos.map((p) => ({ organ: p.organ, filename: p.file.name })),
      plantnet:   rawPlantnet
        ? {
            bestMatch:    rawPlantnet.bestMatch,
            results:      rawPlantnet.results?.slice(0, 5),
            predictedOrgans: rawPlantnet.predictedOrgans,
            remainingIdentificationRequests: rawPlantnet.remainingIdentificationRequests,
            version:      rawPlantnet.version,
            njPriorApplied: true,
            njPriorVersion: njPriorData.version,
          }
        : null,
      chosenCandidate: {
        scientific: resolvedSpecies,
        common:     resolvedCommon,
        score:      resolvedConfidence,
        source:     resolvedSpeciesSource,
      },
      allometryInputs: dbh
        ? { species: resolvedSpecies, dbh_in: Number(dbh), model: estimateStructure(resolvedSpecies, Number(dbh)).model }
        : null,
    };

    const structureSource = structureEdited ? 'manual' : dbh ? 'allometric' : 'manual';

    try {
      await characterizeMarker(marker.id, {
        species:           resolvedSpecies,
        commonName:        resolvedCommon,
        speciesConfidence: resolvedConfidence,
        speciesSource:     resolvedSpeciesSource,
        dbhIn:             dbh || null,
        heightFt:          heightFt || null,
        crownSpreadFt:     crownSpreadFt || null,
        crownBaseFt:       crownBaseFt || null,
        structureSource,
        captureJson,
        primaryImageFile:  photos[0]?.file ?? null,
      });
      // closeCapture is called inside characterizeMarker on success
    } catch (err) {
      setSaveError(`Save failed: ${err.message}`);
      setSaving(false);
    }
  };

  // ── Navigation ──────────────────────────────────────────────────────────────

  const canAdvanceFromPhotos   = photos.length > 0;
  const canAdvanceFromSpecies  = useManual ? (manualSci.trim().length > 0) : candidates.length > 0;
  const canSave                = !saving;

  const currentIdx = STEPS.indexOf(step);

  const handleBack = () => {
    if (step === 'species')   return setStep('photos');
    if (step === 'structure') return setStep(candidates.length > 0 || useManual ? 'species' : 'photos');
    if (step === 'review')    return setStep('structure');
  };

  const handleNext = () => {
    if (step === 'photos' && canAdvanceFromPhotos) return handleIdentify();
    if (step === 'species') return handleToStructure();
    if (step === 'structure') return setStep('review');
    if (step === 'review') return handleSave();
  };

  const nextLabel = {
    photos:    identifying ? 'Identifying…' : 'Identify Species →',
    species:   'Continue →',
    structure: 'Review →',
    review:    saving ? 'Saving…' : 'Save Characterization',
  }[step];

  const canNext = {
    photos:    canAdvanceFromPhotos && !identifying,
    species:   canAdvanceFromSpecies,
    structure: true,
    review:    canSave,
  }[step];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="cap-overlay" role="dialog" aria-modal="true" aria-label="Characterize tree marker">
      {/* Backdrop */}
      <div className="cap-backdrop" onClick={closeCapture} />

      <div className="cap-panel">
        {/* Header */}
        <div className="cap-header">
          <div className="cap-header-meta">
            <span className="cap-marker-id">{marker.id}</span>
            <span className="cap-marker-name">{marker.commonName ?? marker.common_name ?? 'Tree marker'}</span>
          </div>

          {/* Step indicator */}
          <div className="cap-steps">
            {STEPS.map((s, i) => (
              <div key={s} className={`cap-step-dot${s === step ? ' is-active' : i < currentIdx ? ' is-done' : ''}`}>
                {STEP_LABELS[s]}
              </div>
            ))}
          </div>

          <button type="button" className="cap-close" onClick={closeCapture} aria-label="Close">×</button>
        </div>

        {/* Body */}
        <div className="cap-body">
          {step === 'photos' && (
            <PhotosStep
              photos={photos}
              onAddFiles={handleAddFiles}
              onRemove={handleRemovePhoto}
              onOrganChange={handleOrganChange}
              onSkipToStructure={() => { setStep('structure'); }}
            />
          )}
          {step === 'species' && (
            <SpeciesStep
              identifying={identifying}
              identifyError={identifyError}
              quotaRemaining={quotaRemaining}
              candidates={candidates}
              selectedIdx={selectedIdx}
              onSelectIdx={setSelectedIdx}
              useManual={useManual}
              onToggleManual={() => setUseManual((v) => !v)}
              manualScientific={manualSci}
              manualCommon={manualCommon}
              onManualScientificChange={setManualSci}
              onManualCommonChange={setManualCommon}
            />
          )}
          {step === 'structure' && (
            <StructureStep
              speciesForAllometry={resolvedSpecies !== 'Unknown' ? resolvedSpecies : null}
              dbh={dbh}                     onDbh={handleDbhChange}
              heightFt={heightFt}           onHeightFt={makeStructureEdited(setHeightFt)}
              crownSpreadFt={crownSpreadFt} onCrownSpreadFt={makeStructureEdited(setCrownSpreadFt)}
              crownBaseFt={crownBaseFt}     onCrownBaseFt={makeStructureEdited(setCrownBaseFt)}
              structureEdited={structureEdited}
              onRefreshAllometry={refreshAllometry}
            />
          )}
          {step === 'review' && (
            <ReviewStep
              marker={marker}
              species={resolvedSpecies}
              commonName={resolvedCommon}
              dbh={dbh}
              heightFt={heightFt}
              crownSpreadFt={crownSpreadFt}
              speciesSource={resolvedSpeciesSource}
              structureSource={structureEdited ? 'manual' : dbh ? 'allometric' : '—'}
            />
          )}

          {saveError && <p className="cap-error">{saveError}</p>}
        </div>

        {/* Footer */}
        <div className="cap-footer">
          {currentIdx > 0 && (
            <button type="button" className="cap-btn cap-btn-back" onClick={handleBack}>← Back</button>
          )}
          <button
            type="button"
            className="cap-btn cap-btn-next"
            onClick={handleNext}
            disabled={!canNext}
          >
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
