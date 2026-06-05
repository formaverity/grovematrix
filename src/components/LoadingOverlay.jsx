import React from 'react';

export function LoadingOverlay({ error, ready }) {
  return (
    <div className={ready ? 'loading-overlay is-hidden' : 'loading-overlay'}>
      <div className="loading-panel">
        <p className="loading-subtitle">loading grovematrix</p>
        <div className="loading-logo" />
        {error ? (
          <p className="loading-error">
            Point cloud failed to initialize. Check the model asset and refresh.
          </p>
        ) : (
          <>
            <div className="loading-glyph" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <p className="loading-status">point cloud initializing</p>
          </>
        )}
      </div>
    </div>
  );
}
