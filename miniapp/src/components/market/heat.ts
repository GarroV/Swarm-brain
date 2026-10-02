// Хитмап карты — тот же алгоритм, что в хорватском референсе: каждая точка ставит радиальный
// штамп альфы на скрытый холст, накопленная альфа красится шкалой `--heat0..3` темы. Радиус
// около 9 км на всю страну и сжимается при приближении, чтобы в городе было видно районы.

export type ViewBox = { x: number; y: number; w: number; h: number };
export type HeatPoint = { x: number; y: number; weight: number };

const STAMP_ALPHA = 0.22;
const R_WORLD = 13; // радиус штампа в единицах карты на полном виде
const R_MIN = 14, R_MAX = 70; // пределы радиуса, px экрана (×dpr)
const MAX_ALPHA = 235;

/** Шкала 256 оттенков из токенов темы: перечитывается при каждой отрисовке, поэтому смена
 *  темы подхватывается без отдельной подписки на неё. */
function ramp(): Uint8ClampedArray {
  const css = getComputedStyle(document.documentElement);
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 1;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 256, 0);
  [0, 0.35, 0.7, 1].forEach((stop, i) => grad.addColorStop(stop, css.getPropertyValue(`--heat${i}`).trim() || "#FF6A1F"));
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 1);
  return g.getImageData(0, 0, 256, 1).data;
}

export function drawHeat(canvas: HTMLCanvasElement, pts: HeatPoint[], vb: ViewBox, fullW: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = Math.round(canvas.clientWidth * dpr), ch = Math.round(canvas.clientHeight * dpr);
  if (!cw || !ch) return;
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, cw, ch);
  if (!pts.length) return;

  const s = cw / vb.w; // px холста на единицу карты
  const R = Math.max(R_MIN * dpr, Math.min(R_MAX * dpr, R_WORLD * s * Math.sqrt(vb.w / fullW)));
  const off = document.createElement("canvas");
  off.width = cw;
  off.height = ch;
  const o = off.getContext("2d")!;
  for (const p of pts) {
    const x = (p.x - vb.x) * s, y = (p.y - vb.y) * s;
    if (x < -R || y < -R || x > cw + R || y > ch + R) continue;
    const g = o.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, `rgba(0,0,0,${STAMP_ALPHA * p.weight})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    o.fillStyle = g;
    o.fillRect(x - R, y - R, R * 2, R * 2);
  }
  const img = o.getImageData(0, 0, cw, ch);
  const d = img.data, r = ramp();
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (!a) continue;
    d[i] = r[a * 4];
    d[i + 1] = r[a * 4 + 1];
    d[i + 2] = r[a * 4 + 2];
    d[i + 3] = Math.min(MAX_ALPHA, 40 + a * 1.4);
  }
  ctx.putImageData(img, 0, 0);
}
