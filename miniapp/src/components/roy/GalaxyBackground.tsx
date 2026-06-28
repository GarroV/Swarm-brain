"use client";
import { useEffect, useRef } from "react";

// Фон-бэкдроп «Рой»: тёплая тёмная база + спиральная галактика (тёплое ядро-балдж +
// прохладные рукава) + сканлайны + виньетка. Порт фоновой части карты ядра
// (miniapp/public/system-map.html / артефакт «Рой · карта»). Принят за стандарт визуала.
//
// Фиксированный слой ПОЗАДИ контента (pointer-events:none) — UI-панели рисуются сверху.
// Только в тёмной теме (галактика тёмная; в светлой остаётся кремовый фон). Уважает
// prefers-reduced-motion: при reduce рисуем один статичный кадр, без rAF (батарея/доступность).
export function GalaxyBackground() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia?.("(prefers-color-scheme: dark)") && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isDark = () => document.documentElement.classList.contains("dark");

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let W = 0, H = 0, raf = 0, running = false;

    // Спиральная галактика: рукава + плотный балдж + звёздное поле. Тёплое ядро, прохладные рукава.
    const TONES = ["rgba(250,238,212,", "rgba(150,210,225,", "rgba(110,170,200,", "rgba(225,205,160,"];
    type Star = { rf: number; a0: number; sz: number; tw: number; tone: number };
    const GAL: Star[] = [];
    const arms = 4, twist = 3.4, n = 900;
    for (let i = 0; i < n; i++) {
      const t = Math.pow(Math.random(), 0.85), arm = i % arms, spread = 0.04 + (1 - t) * 0.6;
      const ang = arm * (Math.PI * 2 / arms) + t * twist * Math.PI + (Math.random() - 0.5) * spread;
      GAL.push({ rf: Math.min(1, t + (Math.random() - 0.5) * 0.06), a0: ang, sz: 0.35 + (1 - t) * 1.7 + Math.random() * 0.7, tw: Math.random() * 6.283, tone: t < 0.2 ? 0 : (Math.random() < 0.12 ? 3 : (t < 0.6 ? 1 : 2)) });
    }
    for (let i = 0; i < 240; i++) GAL.push({ rf: Math.random() * 0.1, a0: Math.random() * 6.283, sz: 0.5 + Math.random() * 1.5, tw: Math.random() * 6.283, tone: Math.random() < 0.3 ? 0 : 3 });
    for (let i = 0; i < 420; i++) GAL.push({ rf: 0.12 + Math.random() * 0.9, a0: Math.random() * 6.283, sz: 0.35 + Math.random() * 0.85, tw: Math.random() * 6.283, tone: Math.random() < 0.5 ? 1 : 2 });

    const resize = () => {
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      // тёплая тёмная база
      const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.9);
      bg.addColorStop(0, "#101108"); bg.addColorStop(0.55, "#0A0C0A"); bg.addColorStop(1, "#070806");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      // галактика (additive)
      const cx = W * 0.5, cy = H * 0.5, rMax = Math.max(W, H) * 0.7; // вся спираль помещается во весь экран (не зум в ядро)
      const incl = 0.46, tilt = -0.3, cosT = Math.cos(tilt), sinT = Math.sin(tilt);
      const theta = reduce ? 0 : t * 0.00003;
      ctx.globalCompositeOperation = "lighter";
      const hz = ctx.createRadialGradient(cx, cy, 0, cx, cy, rMax);
      hz.addColorStop(0, "rgba(160,195,220,0.09)"); hz.addColorStop(0.45, "rgba(120,170,200,0.04)"); hz.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = hz; ctx.fillRect(0, 0, W, H);
      // Бульдж-ядро приглушено (раньше светило слишком ярко за текстом → нечитаемо).
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rMax * 0.4);
      cg.addColorStop(0, "rgba(250,224,158,0.18)"); cg.addColorStop(0.16, "rgba(246,212,150,0.09)"); cg.addColorStop(0.5, "rgba(170,205,225,0.03)"); cg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, rMax * 0.4, 0, 6.283); ctx.fill();
      let halos = 0;
      for (let i = 0; i < GAL.length; i++) {
        const s = GAL[i], r = s.rf * rMax, a = s.a0 + theta;
        const dx = r * Math.cos(a), dy = r * Math.sin(a) * incl;
        const x = cx + dx * cosT - dy * sinT, y = cy + dx * sinT + dy * cosT;
        if (x < -30 || x > W + 30 || y < -30 || y > H + 30) continue;
        const tw = reduce ? 1 : (0.72 + 0.28 * Math.sin(t * 0.0012 + s.tw)); // мерцание спокойнее
        const al = (0.6 - s.rf * 0.3) * tw * 0.42; if (al < 0.02) continue;   // звёзды чуть ярче (видно в щелях)
        if (s.sz > 1.9 && halos < 70) { halos++; const gg = ctx.createRadialGradient(x, y, 0, x, y, s.sz * 5); gg.addColorStop(0, TONES[s.tone] + (al * 0.5) + ")"); gg.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, s.sz * 5, 0, 6.283); ctx.fill(); }
        ctx.fillStyle = TONES[s.tone] + al + ")"; const d = s.sz; ctx.fillRect(x - d * 0.5, y - d * 0.5, d, d);
      }
      ctx.globalCompositeOperation = "source-over";
      // сканлайны (ретро-консоль) + тёмная вуаль (читаемость) + виньетка
      ctx.fillStyle = "rgba(120,210,220,0.014)";
      for (let yy = 0; yy < H; yy += 4) ctx.fillRect(0, yy, W, 1);
      ctx.fillStyle = "rgba(8,9,6,0.06)"; ctx.fillRect(0, 0, W, H); // очень лёгкая вуаль (затемнение — на фрейме/карточках)
      const vg = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.32, cx, cy, Math.max(W, H) * 0.9);
      vg.addColorStop(0, "rgba(7,8,6,0)"); vg.addColorStop(1, "rgba(7,8,6,0.5)");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    };

    const loop = (ts: number) => { if (!running) return; draw(ts); raf = requestAnimationFrame(loop); };

    const start = () => {
      if (!isDark()) { running = false; ctx.clearRect(0, 0, W, H); return; }
      resize();
      if (reduce) { draw(0); running = false; return; }
      if (!running) { running = true; raf = requestAnimationFrame(loop); }
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
