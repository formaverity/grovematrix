import React, { useRef, useEffect, useLayoutEffect, useState } from 'react';
import * as Plot from '@observablehq/plot';

/**
 * Responsive Observable Plot wrapper.
 *
 * @param {function} makeSpec  (width: number) => Plot.PlotOptions  — wrap in useCallback
 * @param {string}   className
 * @param {object}   style
 */
export function PlotFigure({ makeSpec, className, style }) {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || width === 0) return;
    const node = Plot.plot(makeSpec(width));
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(node);
    return () => { try { if (el.contains(node)) el.removeChild(node); } catch {} };
  }, [makeSpec, width]);

  return <div ref={containerRef} className={className} style={style} />;
}
