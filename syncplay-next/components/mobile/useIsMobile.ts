'use client';
import { useEffect, useState } from 'react';

/** Reactive viewport check. Returns true when width <= breakpoint. SSR-safe: false until mount. */
export function useIsMobile(breakpoint = 640): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setM(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [breakpoint]);
  return m;
}
