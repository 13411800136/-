import { useEffect, useRef } from 'react';

const FX_DURATION_MS = 1100;
const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Kind = 'spark' | 'glow' | 'streak';

interface Particle {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  tone: string;
  kind: Kind;
  spin: number;
}

/**
 * 按钮粒子层（Particular 风格）：
 * 三层发射——锐利火花、柔光颗粒、拖尾流线；叠加混合 + 渐隐拖影。
 * 全部粒子寿命统一 1.1s，与 CSS 特效时长一致。
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
    let last = performance.now();

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

    const PALETTE = ['#dd9f22', '#b8761f', '#111614', '#8a6a3a'];
    const GLOW_PALETTE = ['rgba(221,159,34,', 'rgba(184,118,31,', 'rgba(17,22,20,'];

    const emit = (element: Element) => {
      if (REDUCED()) return;
      const rect = element.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      // 火花：快、小而锐
      for (let index = 0; index < 26; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.2 + Math.random() * 5.2;
        particles.push({
          x: cx + (Math.random() - 0.5) * rect.width * 0.6,
          y: cy + (Math.random() - 0.5) * rect.height * 0.4,
          px: 0,
          py: 0,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.1,
          age: 0,
          life: FX_DURATION_MS,
          size: 1.4 + Math.random() * 2.6,
          tone: PALETTE[index % PALETTE.length]!,
          kind: 'spark',
          spin: 0
        });
      }

      // 柔光：慢、带光晕
      for (let index = 0; index < 14; index += 1) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
        const speed = 0.4 + Math.random() * 1.6;
        particles.push({
          x: cx + (Math.random() - 0.5) * rect.width * 0.7,
          y: cy + (Math.random() - 0.5) * rect.height * 0.3,
          px: 0,
          py: 0,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.5,
          age: 0,
          life: FX_DURATION_MS,
          size: 10 + Math.random() * 22,
          tone: GLOW_PALETTE[index % GLOW_PALETTE.length]!,
          kind: 'glow',
          spin: 0
        });
      }

      // 流线：沿速度方向的短拖尾
      for (let index = 0; index < 10; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 3.2 + Math.random() * 4.2;
        particles.push({
          x: cx,
          y: cy,
          px: 0,
          py: 0,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          age: 0,
          life: FX_DURATION_MS,
          size: 1 + Math.random() * 1.4,
          tone: PALETTE[(index + 1) % PALETTE.length]!,
          kind: 'streak',
          spin: 0
        });
      }

      if (!frame) frame = requestAnimationFrame(tick);
    };

    const tick = (now: number) => {
      const delta = Math.min(2.4, Math.max(0.4, (now - last) / 16.667));
      last = now;

      // 拖影：用 destination-out 渐隐上一帧，形成粒子尾迹
      context.globalCompositeOperation = 'destination-out';
      context.fillStyle = 'rgba(0,0,0,0.22)';
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = 'source-over';

      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index]!;
        particle.px = particle.x;
        particle.py = particle.y;
        particle.x += particle.vx * delta;
        particle.y += particle.vy * delta;
        particle.vy += (particle.kind === 'glow' ? 0.008 : 0.055) * delta;
        particle.vx *= 1 - 0.012 * delta;
        particle.vy *= 1 - 0.008 * delta;
        particle.age += delta * 16.667;
        if (particle.age >= particle.life) {
          particles.splice(index, 1);
          continue;
        }
        const progress = particle.age / particle.life;
        const alpha = Math.pow(1 - progress, 1.4);

        if (particle.kind === 'glow') {
          const radius = particle.size * (0.7 + progress * 0.7);
          const gradient = context.createRadialGradient(
            particle.x,
            particle.y,
            0,
            particle.x,
            particle.y,
            radius
          );
          gradient.addColorStop(0, `${particle.tone}${(alpha * 0.5).toFixed(3)})`);
          gradient.addColorStop(1, `${particle.tone}0)`);
          context.globalCompositeOperation = 'lighter';
          context.fillStyle = gradient;
          context.beginPath();
          context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
          context.fill();
          context.globalCompositeOperation = 'source-over';
          continue;
        }

        context.globalAlpha = alpha;
        if (particle.kind === 'streak') {
          context.strokeStyle = particle.tone;
          context.lineWidth = particle.size;
          context.lineCap = 'round';
          context.beginPath();
          context.moveTo(particle.x - particle.vx * 2.6, particle.y - particle.vy * 2.6);
          context.lineTo(particle.x, particle.y);
          context.stroke();
        } else {
          context.fillStyle = particle.tone;
          context.fillRect(
            particle.x - particle.size / 2,
            particle.y - particle.size / 2,
            particle.size,
            particle.size
          );
        }
        context.globalAlpha = 1;
      }

      frame = particles.length > 0 ? requestAnimationFrame(tick) : 0;
      if (!frame) {
        context.clearRect(0, 0, width, height);
      }
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const button = target?.closest('[data-fx-particles]');
      if (button) emit(button);
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
      const layer = target?.closest<HTMLElement>('.fx-parallax, [data-fx-parallax]');
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