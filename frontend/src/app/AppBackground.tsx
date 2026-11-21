import { useEffect, useRef } from 'react';

/**
 * 背景层：用户提供的蓝天白墙猫咪插画 + 蓝色薄雾 + 颗粒 + 暗角。
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
      <div className="app-bg-photo" />
      <div className="app-bg-wash" />
      <div className="app-bg-grain" />
      <div className="app-bg-vignette" />
    </div>
  );
}