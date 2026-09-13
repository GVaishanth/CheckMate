/**
 * Title-screen background: drifting algebraic notation and edge coordinates.
 * Canvas 2D only; static under reduced motion; pauses when the tab is hidden.
 */
import { useEffect, useRef } from 'react';

const NOTATION = ['Nf3', 'O-O', 'Qxd5+', 'exd6', 'Rxe8#', 'Bb5', 'c4', 'Nd2', 'fxe4', 'Ka1', 'g6', 'Bxc6', 'd5', 'Nf6', 'Qh5', 'axb5', 'Kf7', 'Re1'];
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

interface Particle {
  x: number;
  y: number;
  vy: number;
  text: string;
  size: number;
  alpha: number;
  drift: number;
}

export function HeroCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.dataset.reducedMotion === 'true';

    let width = 0;
    let height = 0;
    let raf = 0;
    let running = true;
    let particles: Particle[] = [];

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas!.width = Math.max(1, Math.round(width * dpr));
      canvas!.height = Math.max(1, Math.round(height * dpr));
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const spawn = (n: number) => {
      particles = [];
      for (let i = 0; i < n; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vy: -(0.05 + Math.random() * 0.12),
          text: NOTATION[Math.floor(Math.random() * NOTATION.length)]!,
          size: 10 + Math.random() * 13,
          alpha: 0.03 + Math.random() * 0.05,
          drift: (Math.random() - 0.5) * 0.06,
        });
      }
    };

    const draw = (t: number) => {
      ctx!.clearRect(0, 0, width, height);

      // Edge coordinates — the board motif.
      ctx!.fillStyle = 'rgba(93, 101, 114, 0.35)';
      ctx!.font = '600 11px "JetBrains Mono", monospace';
      const pad = 18;
      for (let i = 0; i < 8; i++) {
        const seg = width / 8;
        ctx!.fillText(FILES[i]!, pad + i * seg, height - 22);
        ctx!.fillText(RANKS[i]!, width - 26, pad + 26 + i * ((height - 70) / 8));
      }

      // Notation particles.
      for (const p of particles) {
        if (!reduce) {
          p.y += p.vy;
          p.x += p.drift + Math.sin((t + p.x) * 0.0004) * 0.04;
          if (p.y < -30) {
            p.y = height + 20;
            p.x = Math.random() * width;
          }
        }
        ctx!.fillStyle = `rgba(232, 228, 214, ${p.alpha})`;
        ctx!.font = `600 ${p.size}px "JetBrains Mono", monospace`;
        ctx!.fillText(p.text, p.x, p.y);
      }

      // Knight silhouette.
      ctx!.save();
      ctx!.translate(width * 0.5, height * 0.5);
      ctx!.rotate(-0.1);
      ctx!.fillStyle = 'rgba(210, 168, 80, 0.045)';
      const s = Math.min(width, height) * 0.62;
      drawKnight(ctx!, s);
      ctx!.restore();

      if (running && !reduce) raf = requestAnimationFrame(draw);
    };

    resize();
    spawn(Math.max(12, Math.round(width / 90)));
    if (reduce) {
      draw(0);
    } else {
      raf = requestAnimationFrame(draw);
    }

    const onResize = () => {
      resize();
      spawn(Math.max(12, Math.round(width / 90)));
    };
    const onVisibility = () => {
      running = document.visibilityState === 'visible';
      if (running && !reduce) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(draw);
      }
    };

    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="hero-canvas" aria-hidden="true" />;
}

function drawKnight(ctx: CanvasRenderingContext2D, size: number): void {
  const k = size / 48;
  ctx.save();
  ctx.scale(k, k);
  ctx.beginPath();
  ctx.moveTo(14.6, 39.5);
  ctx.bezierCurveTo(14.1, 33, 14.8, 28.1, 17.2, 24.1);
  ctx.lineTo(12.8, 26.1);
  ctx.bezierCurveTo(11, 26.9, 9.4, 25.2, 10.4, 23.6);
  ctx.lineTo(11.6, 21.7);
  ctx.lineTo(15.6, 20.1);
  ctx.bezierCurveTo(18.6, 15.7, 21.1, 13.1, 25.3, 11);
  ctx.lineTo(24.7, 7.6);
  ctx.lineTo(27.8, 9.5);
  ctx.lineTo(30.2, 7);
  ctx.lineTo(30.8, 10.5);
  ctx.bezierCurveTo(35.5, 13.1, 37.4, 18.5, 37.7, 25.7);
  ctx.bezierCurveTo(37.9, 30.1, 37.8, 34.9, 37.7, 39.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
