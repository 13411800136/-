import { useEffect, useRef } from 'react';

const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  tone: string;
}

/**
 * 按钮特效层：粒子爆发 + 视差指针变量。
 * 只做视觉，不拦截事件；减少动态偏好下整体关闭。
 */
export function EffectsLayer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const particles: Particle[] = [];
    let frame = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      context.clearRect(0, 0, width, height);
      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index]!;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.16;
        particle.vx *= 0.985;
        particle.life -= 1;
        if (particle.life <= 0) {
          particles.splice(index, 1);
          continue;
        }
        const alpha = Math.max(0, particle.life / particle.maxLife);
        context.globalAlpha = alpha;
        context.fillStyle = particle.tone;
        context.fillRect(
          particle.x - particle.size / 2,
          particle.y - particle.size / 2,
          particle.size,
          particle.size
        );
      }
      context.globalAlpha = 1;
      frame = particles.length > 0 ? requestAnimationFrame(draw) : 0;
    };

    const burst = (element: Element) => {
      if (REDUCED()) return;
      const rect = element.getBoundingClientRect();
      const originX = rect.left + rect.width / 2;
      const originY = rect.top + rect.height / 2;
      const tones = ['#dd9f22', '#111614', '#b08a6a', '#dd9f22'];
      for (let index = 0; index < 24; index += 1) {
        const angle = (Math.PI * 2 * index) / 24 + Math.random() * 0.4;
        const speed = 1.6 + Math.random() * 3.4;
        particles.push({
          x: originX,
          y: originY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.8,
          life: 26 + Math.random() * 16,
          maxLife: 42,
          size: 2.5 + Math.random() * 4,
          tone: tones[index % tones.length]!
        });
      }
      if (!frame) frame = requestAnimationFrame(draw);
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const button = target?.closest('[data-fx-particles]');
      if (button) burst(button);
    };

    const onPointerMove = (event: PointerEvent) => {
      const target = event.target as Element | null;
      const layer = target?.closest<HTMLElement>('.fx-parallax, [data-fx-parallax]');
      if (!layer) return;
      const rect = layer.getBoundingClientRect();
      const px = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2));
      const py = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2));
      layer.style.setProperty('--fx-px', px.toFixed(3));
      layer.style.setProperty('--fx-py', py.toFixed(3));
    };

    const onPointerOut = (event: PointerEvent) => {
      const target = event.target as Element | null;
      const layer = target?.closest<HTMLElement>('[data-fx-parallax]');
      if (!layer) return;
      if (layer.contains(event.relatedTarget as Node | null)) return;
      layer.style.setProperty('--fx-px', '0');
      layer.style.setProperty('--fx-py', '0');
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerout', onPointerOut, { passive: true });

    return () => {
      window.removeEventListener('resize', resize);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerout', onPointerOut);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} className="fx-particle-layer" aria-hidden="true" />;
}