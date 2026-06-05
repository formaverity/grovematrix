import React from 'react';

export function MarkerList({ markers, selectedMarkerId, onDeleteMarker, onSelectMarker }) {
  return (
    <div className="marker-list">
      {markers.length ? (
        markers.map((marker) => (
          <button
            key={marker.id}
            type="button"
            className={marker.id === selectedMarkerId ? 'marker-row is-selected' : 'marker-row'}
            onClick={() => onSelectMarker(marker)}
          >
            <span className="marker-row-main">
              <span className="marker-dot" />
              <span>{marker.id}</span>
            </span>
            <span
              className="marker-delete"
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onDeleteMarker(marker.id); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onDeleteMarker(marker.id);
                }
              }}
            >
              x
            </span>
          </button>
        ))
      ) : (
        <p className="marker-list-empty">No markers placed yet.</p>
      )}
    </div>
  );
}
