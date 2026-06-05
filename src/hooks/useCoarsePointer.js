import { useState, useEffect } from 'react';

export function useCoarsePointer() {
  const [isCoarse, setIsCoarse] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;
  });

  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setIsCoarse(query.matches || window.innerWidth < 768);
    query.addEventListener?.('change', update);
    window.addEventListener('resize', update);
    return () => {
      query.removeEventListener?.('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return isCoarse;
}
