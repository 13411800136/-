import { useEffect, useRef } from 'react';

const ROWS = [
  { top: 44, blocks: 15, seed: 3 },
  { top: 57, blocks: 21, seed: 7 },
  { top: 69, blocks: 27, seed: 11 }
];

/**
 * 背景层：奶油色“档案柜”立体方块 + 柔和光晕 + 颗粒。
 * 只做视觉，固定在最底层；指针视差在减少动态偏好下关闭。
 */
export function AppBackground() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const x = event.clientX / window.innerWidth - 0.5;
        const y = event.clientY / window.innerHeight - 0.5;
        element.style.setProperty('--bg-x', (x * 2).toFixed(3));
        element.style.setProperty('--bg-y', (y * 2).toFixed(3));
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="app-bg" aria-hidden="true" ref={ref}>
      <div className="app-bg-wash" />
      <div className="app-bg-glow" />
      <div className="app-bg-archive">
        {ROWS.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className="app-bg-row"
            style={{ top: `${row.top}%`, opacity: 0.92 - rowIndex * 0.16 }}
          >
            {Array.from({ length: row.blocks }).map((_, index) => (
              <span
                key={index}
                className="app-bg-block"
                style={{ height: `${30 + ((index * 37 + row.seed * 13) % 44)}%` }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="app-bg-grain" />
      <div className="app-bg-vignette" />
    </div>
  );
}