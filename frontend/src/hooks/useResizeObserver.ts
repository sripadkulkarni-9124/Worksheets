import { useEffect, useRef, useState } from 'react';

interface Dimensions {
  width: number;
  height: number;
}

export function useResizeObserver<T extends HTMLElement>(): [
  React.RefObject<T | null>,
  Dimensions,
] {
  const ref = useRef<T | null>(null);
  const [dims, setDims] = useState<Dimensions>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDims({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, dims];
}
