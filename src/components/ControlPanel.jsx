import React, { useEffect, useRef } from 'react';
import { MarkerList } from './MarkerList.jsx';
import { useGroveStore } from '../store/useGroveStore.js';

const DEBUG_INTERACTIONS = false;

const LAYER_LABELS = { buildings: 'Buildings', hardscape: 'Roads', greenspace: 'Greenspace' };


export function ControlPanel({
  debugPointerActive,
  drawerOpen,
  menuOpen,
  markers,
  placementMode,
  selectedMarker,
  onCopyJson,
  onDeleteSelected,
  onDeleteMarker,
  onDownloadJson,
  onPanelHoverChange,
  onSelectMarker,
  onToggleDrawer,
  onToggleMenu,
  onTogglePlacement,
  onTopView,
}) {
  const viewMode              = useGroveStore((s) => s.viewMode);
  const openCapture           = useGroveStore((s) => s.openCapture);
  const layerVisibility       = useGroveStore((s) => s.layerVisibility);
  const toggleLayerVisibility = useGroveStore((s) => s.toggleLayerVisibility);
  const cloudOpacity          = useGroveStore((s) => s.cloudOpacity);
  const setCloudOpacity       = useGroveStore((s) => s.setCloudOpacity);

  const logoRef = useRef(null);

  useEffect(() => {
    const handleMouseMove = (event) => {
      if (!logoRef.current) return;
      const rect = logoRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const deltaX = (event.clientX - centerX) / window.innerWidth;
      const deltaY = (event.clientY - centerY) / window.innerHeight;
      logoRef.current.style.transform = `translate(${deltaX * 8}px, ${deltaY * 8}px)`;
    };
    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <div className="hud">
      <div
        ref={logoRef}
        className={`gm-logo ${menuOpen ? 'is-open' : ''}`}
        onClick={onToggleMenu}
        role="button"
        aria-label="Toggle menu"
      />
      <div
        className={menuOpen ? 'overlay is-open' : 'overlay'}
        onPointerEnter={() => onPanelHoverChange(true)}
        onPointerLeave={() => onPanelHoverChange(false)}
        onFocusCapture={() => onPanelHoverChange(true)}
        onBlurCapture={() => onPanelHoverChange(false)}
      >
        {menuOpen ? (
          <div className="menu-panel">
            {placementMode ? (
              <p className="instruction-line">Tap to place. Drag markers to adjust.</p>
            ) : null}
            {DEBUG_INTERACTIONS ? (
              <p className="debug-line">
                Point hover: {debugPointerActive ? 'active' : 'inactive'}
              </p>
            ) : null}

            <div className="control-row">
              <button
                type="button"
                className={placementMode ? 'is-active' : ''}
                onClick={onTogglePlacement}
              >
                Placement {placementMode ? 'On' : 'Off'}
              </button>
              <button type="button" onClick={onTopView}>
                Plan View
              </button>
              <button type="button" onClick={onCopyJson} disabled={!markers.length}>
                Copy JSON
              </button>
              <button type="button" onClick={onDownloadJson} disabled={!markers.length}>
                Download JSON
              </button>
              <button type="button" onClick={onDeleteSelected} disabled={!selectedMarker}>
                Delete Selected
              </button>
              <button
                type="button"
                className={selectedMarker ? 'is-characterize' : ''}
                disabled={!selectedMarker}
                onClick={() => selectedMarker && openCapture(selectedMarker.id)}
              >
                ✦ Characterize
              </button>
            </div>

            {(viewMode === 'map2d' || viewMode === 'city3d') && (
              <div className="layer-toggles">
                <span className="layer-toggles-label">Layers</span>
                <div className="layer-toggles-row">
                  {Object.keys(LAYER_LABELS).map((layer) => (
                    <button
                      key={layer}
                      type="button"
                      className={`layer-toggle-btn${layerVisibility[layer] ? ' is-active' : ''}`}
                      onClick={() => toggleLayerVisibility(layer)}
                    >
                      {LAYER_LABELS[layer]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {viewMode === 'city3d' && (
              <div className="crossfade-control">
                <div className="crossfade-label-row">
                  <span className="crossfade-label">City</span>
                  <span className="crossfade-label">Pointcloud</span>
                </div>
                <input
                  type="range"
                  className="crossfade-slider"
                  min="0"
                  max="1"
                  step="0.01"
                  value={cloudOpacity}
                  onChange={(e) => setCloudOpacity(Number(e.target.value))}
                />
              </div>
            )}

            <details className="selection-card">
              <summary>
                <span>Selected</span>
                <strong>{selectedMarker ? selectedMarker.id : 'None'}</strong>
              </summary>
              <p>{selectedMarker ? 'Details in scene balloon' : 'No marker selected'}</p>
            </details>

            <div className={drawerOpen ? 'list-card is-open' : 'list-card'}>
              <button type="button" className="drawer-toggle" onClick={onToggleDrawer}>
                Markers ({markers.length})
              </button>
              {drawerOpen ? (
                <MarkerList
                  markers={markers}
                  selectedMarkerId={selectedMarker?.id ?? null}
                  onDeleteMarker={onDeleteMarker}
                  onSelectMarker={onSelectMarker}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
