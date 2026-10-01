"use client";
import { useEffect, useRef } from "react";

// Фон-бэкдроп «Рой»: ночная сине-чёрная база + спиральная галактика (циановое ядро-балдж +
// прохладные рукава) + сканлайны + виньетка. Порт фоновой части карты ядра
// (miniapp/public/system-map.html / артефакт «Рой · карта»). Принят за стандарт визуала.
//
// Фиксированный слой ПОЗАДИ контента (pointer-events:none) — UI-панели рисуются сверху.
// Только в тёмной теме (галактика тёмная; в светлой остаётся кремовый фон). Уважает
// prefers-reduced-motion: при reduce рисуем один статичный кадр, без rAF (батарея/доступность).
//
// Заметнее с 01.10.2026 (владелец: «галактику давай-ка сделаем более заметной. в правом краю так
// точно надо чтобы больше частиц пролетало»): звёзд больше и они ярче, а в полосе справа от поля
// (на широком мониторе там пусто) — ещё ярче и свой поток «пролетающих» частиц. Под полем
// карточки непрозрачные, поэтому прибавка видна в просветах и справа, а не под текстом.
//
// Цена кадра. Всё, что не движется (база, туман, ядро, сканлайны, вуаль, виньетка), рисуется
// один раз на ресайз в два закадровых холста и кладётся drawImage; ореолы крупных звёзд —
// готовый спрайт на тон, а не createRadialGradient на звезду в каждом кадре. Так звёзд стало
// больше, а кадр — дешевле прежнего (замер — в PR).

const TONES = ["226,240,255", "120,225,245", "90,160,230", "160,235,255"];
const ARMS = 4, TWIST = 3.4;
const SPIRAL_N = 1200, CORE_N = 300, FIELD_N = 600; // было 900 / 240 / 420
const DRIFT_N = 170; // поток справа от поля
const HALO_MAX = 110; // было 70
const ALPHA = 0.6; // общая яркость звёзд, было 0.5
const GUTTER_BOOST = 1.45; // справа от поля звёзды ярче: там нет карточек и текста
const MIN_GUTTER = 80; // уже — полосы справа считай нет, поток идёт по всей ширине
const PANE_POLL_FRAMES = 90; // край поля перечитываем раз в ~1.5 с, а не каждый кадр

type Star = { rf: number; a0: number; sz: number; tw: number; tone: number };
type Drift = { x: number; y: number; vx: number; vy: number; sz: number; al: number; tw: number; tone: number };

function makeStars(): Star[] {
  const out: Star[] = [];
  for (let i = 0; i < SPIRAL_N; i++) {
    const t = Math.pow(Math.random(), 0.85), arm = i % ARMS, spread = 0.04 + (1 - t) * 0.6;
    const ang = arm * (Math.PI * 2 / ARMS) + t * TWIST * Math.PI + (Math.random() - 0.5) * spread;
    out.push({ rf: Math.min(1, t + (Math.random() - 0.5) * 0.06), a0: ang, sz: 0.35 + (1 - t) * 1.7 + Math.random() * 0.7, tw: Math.random() * 6.283, tone: t < 0.2 ? 0 : (Math.random() < 0.12 ? 3 : (t < 0.6 ? 1 : 2)) });
  }
  for (let i = 0; i < CORE_N; i++) out.push({ rf: Math.random() * 0.1, a0: Math.random() * 6.283, sz: 0.5 + Math.random() * 1.5, tw: Math.random() * 6.283, tone: Math.random() < 0.3 ? 0 : 3 });
  for (let i = 0; i < FIELD_N; i++) out.push({ rf: 0.12 + Math.random() * 0.9, a0: Math.random() * 6.283, sz: 0.35 + Math.random() * 0.85, tw: Math.random() * 6.283, tone: Math.random() < 0.5 ? 1 : 2 });
  return out;
}

// Пролетающие частицы: медленный дрейф влево-вверх по полосе справа, с коротким хвостом.
function makeDrift(): Drift[] {
  return Array.from({ length: DRIFT_N }, () => {
    const fast = Math.random() < 0.18; // редкие «кометы» быстрее и с хвостом подлиннее
    const v = (fast ? 0.045 : 0.012) + Math.random() * (fast ? 0.05 : 0.025); // px/мс
    return { x: Math.random(), y: Math.random(), vx: -v, vy: -v * (0.15 + Math.random() * 0.35), sz: 0.6 + Math.random() * (fast ? 1.4 : 1.1), al: 0.35 + Math.random() * 0.5, tw: Math.random() * 6.283, tone: Math.random() < 0.55 ? 1 : (Math.random() < 0.5 ? 0 : 3) };
  });
}

function haloSprite(tone: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${tone},1)`); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return c;
}

/** Неподвижные слои: база + туман + ядро (под звёздами) и сканлайны + вуаль + виньетка (над ними). */
function paintStatic(base: CanvasRenderingContext2D, over: CanvasRenderingContext2D, W: number, H: number) {
  const cx = W * 0.5, cy = H * 0.5, rMax = Math.max(W, H) * 1.05;
  base.clearRect(0, 0, W, H);
  const bg = base.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.9);
  bg.addColorStop(0, "#0A1020"); bg.addColorStop(0.55, "#070A12"); bg.addColorStop(1, "#040509");
  base.fillStyle = bg; base.fillRect(0, 0, W, H);
  base.globalCompositeOperation = "lighter";
  const hz = base.createRadialGradient(cx, cy, 0, cx, cy, rMax);
  hz.addColorStop(0, "rgba(160,195,220,0.10)"); hz.addColorStop(0.45, "rgba(120,170,200,0.05)"); hz.addColorStop(1, "rgba(0,0,0,0)");
  base.fillStyle = hz; base.fillRect(0, 0, W, H);
  // Бульдж-ядро приглушено (раньше светило слишком ярко за текстом → нечитаемо) — не трогаем.
  const cg = base.createRadialGradient(cx, cy, 0, cx, cy, rMax * 0.4);
  cg.addColorStop(0, "rgba(0,229,255,0.16)"); cg.addColorStop(0.16, "rgba(60,200,255,0.08)"); cg.addColorStop(0.5, "rgba(170,205,225,0.03)"); cg.addColorStop(1, "rgba(0,0,0,0)");
  base.fillStyle = cg; base.beginPath(); base.arc(cx, cy, rMax * 0.4, 0, 6.283); base.fill();
  base.globalCompositeOperation = "source-over";

  over.clearRect(0, 0, W, H);
  over.fillStyle = "rgba(120,210,220,0.014)"; // сканлайны (ретро-консоль)
  for (let yy = 0; yy < H; yy += 4) over.fillRect(0, yy, W, 1);
  over.fillStyle = "rgba(4,6,12,0.06)"; over.fillRect(0, 0, W, H); // очень лёгкая вуаль
  const vg = over.createRadialGradient(cx, cy, Math.min(W, H) * 0.32, cx, cy, Math.max(W, H) * 0.9);
  vg.addColorStop(0, "rgba(4,5,9,0)"); vg.addColorStop(1, "rgba(4,5,9,0.42)"); // виньетка мягче (было 0.5): края светлее
  over.fillStyle = vg; over.fillRect(0, 0, W, H);
}

export function GalaxyBackground() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const isDark = () => document.documentElement.classList.contains("dark");
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let W = 0, H = 0, raf = 0, running = false, frame = 0, lastTs = 0;
    let gutterL = 0; // левый край полосы справа от поля, px; W — полосы нет

    const GAL = makeStars();
    const DRIFT = makeDrift();
    const HALOS = TONES.map(haloSprite);
    const baseC = document.createElement("canvas"), overC = document.createElement("canvas");
    const base = baseC.getContext("2d")!, over = overC.getContext("2d")!;

    const readGutter = () => {
      const pane = document.querySelector(".roy-pane");
      const right = pane ? pane.getBoundingClientRect().right : W;
      gutterL = W - right >= MIN_GUTTER ? right : W;
    };

    const resize = () => {
      W = window.innerWidth; H = window.innerHeight;
      for (const c of [canvas, baseC, overC]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      for (const g of [ctx, base, over]) g.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintStatic(base, over, W, H);
      readGutter();
    };

    const drawDrift = (t: number, dt: number) => {
      const x0 = gutterL < W ? gutterL : 0, span = W - x0;
      for (const p of DRIFT) {
        if (!reduce) {
          p.x += (p.vx * dt) / span; p.y += (p.vy * dt) / H;
          if (p.x < 0) { p.x += 1; p.y = Math.random(); }
          if (p.y < 0) p.y += 1;
        }
        const x = x0 + p.x * span, y = p.y * H;
        const tw = reduce ? 1 : 0.75 + 0.25 * Math.sin(t * 0.002 + p.tw);
        const al = p.al * tw;
        ctx.fillStyle = `rgba(${TONES[p.tone]},${al})`;
        ctx.fillRect(x - p.sz * 0.5, y - p.sz * 0.5, p.sz, p.sz);
        // Хвост по направлению полёта — видно, что частица летит, а не мерцает на месте.
        const tail = -p.vx * 260;
        ctx.fillStyle = `rgba(${TONES[p.tone]},${al * 0.28})`;
        ctx.fillRect(x, y - p.sz * 0.25, tail, Math.max(0.6, p.sz * 0.5));
      }
    };

    const draw = (t: number) => {
      const dt = lastTs ? Math.min(64, t - lastTs) : 16; lastTs = t;
      if (++frame % PANE_POLL_FRAMES === 0) readGutter();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(baseC, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // галактика (additive)
      const cx = W * 0.5, cy = H * 0.5, rMax = Math.max(W, H) * 1.05; // спираль тянется во всю ширину
      const incl = 0.46, tilt = -0.3, cosT = Math.cos(tilt), sinT = Math.sin(tilt);
      const theta = reduce ? 0 : t * 0.000045; // вращение заметнее (было 0.00003)
      ctx.globalCompositeOperation = "lighter";
      let halos = 0;
      for (let i = 0; i < GAL.length; i++) {
        const s = GAL[i], r = s.rf * rMax, a = s.a0 + theta;
        const dx = r * Math.cos(a), dy = r * Math.sin(a) * incl;
        const x = cx + dx * cosT - dy * sinT, y = cy + dx * sinT + dy * cosT;
        if (x < -30 || x > W + 30 || y < -30 || y > H + 30) continue;
        const tw = reduce ? 1 : (0.72 + 0.28 * Math.sin(t * 0.0012 + s.tw));
        let al = (0.6 - s.rf * 0.3) * tw * ALPHA;
        if (x > gutterL) al = Math.min(1, al * GUTTER_BOOST);
        if (al < 0.02) continue;
        if (s.sz > 1.9 && halos < HALO_MAX) {
          halos++;
          const hr = s.sz * 5;
          ctx.globalAlpha = al * 0.5;
          ctx.drawImage(HALOS[s.tone], x - hr, y - hr, hr * 2, hr * 2);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = `rgba(${TONES[s.tone]},${al})`; const d = s.sz; ctx.fillRect(x - d * 0.5, y - d * 0.5, d, d);
      }
      drawDrift(t, dt);
      ctx.globalCompositeOperation = "source-over";
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(overC, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const loop = (ts: number) => { if (!running) return; draw(ts); raf = requestAnimationFrame(loop); };

    const start = () => {
      if (!isDark()) { running = false; ctx.clearRect(0, 0, W, H); return; }
      resize();
      if (reduce) { draw(0); running = false; return; }
      if (!running) { running = true; lastTs = 0; raf = requestAnimationFrame(loop); }
    };

    const onResize = () => { resize(); if (reduce && isDark()) draw(0); };
    window.addEventListener("resize", onResize);
    // Тема следует за системой (layout вешает/снимает .dark на <html>) — реагируем.
    const themeObs = new MutationObserver(start);
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    // Пауза анимации, когда вкладка скрыта (батарея).
    const onVis = () => { if (document.hidden) { running = false; cancelAnimationFrame(raf); } else start(); };
    document.addEventListener("visibilitychange", onVis);

    start();
    return () => {
      running = false; cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      themeObs.disconnect();
    };
  }, []);

  // Только в тёмной теме; позади всего; не перехватывает клики.
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 hidden dark:block"
    />
  );
}
