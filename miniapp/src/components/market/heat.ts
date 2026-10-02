// Хитмап карты — drawHeat эталона: каждая точка ставит радиальный штамп альфы на скрытый холст
// (пекарня — .10, остальные — .22), накопленная альфа красится шкалой `--heat0..3` темы. Радиус
// около 9 км на всю страну и сжимается при приближении, чтобы в городе было видно районы.
import type { ViewBox } from "@/lib/marketMap";

export type { ViewBox };
export type HeatPoint = { x: number; y: number; bakery: boolean };

const ALPHA = 0.22, ALPHA_BAKERY = 0.1;
const R_WORLD = 13; // радиус штампа в единицах карты на полном виде
const R_MIN = 14, R_MAX = 70; // пределы радиуса, px экрана (×dpr)
const MAX_ALPHA = 235;

let rampCache: { key: string; data: Uint8ClampedArray } | null = null;

/** Шкала 256 оттенков из токенов темы. Токены живут на корне `.mkt`, а не на <html>, поэтому
 *  читаются с самого холста; кэш сбрасывается, когда меняются крайние цвета (смена темы). */
function ramp(el: Element): Uint8ClampedArray {
  const css = getComputedStyle(el);
  const tok = [0, 1, 2, 3].map((i) => css.getPropertyValue(`--heat${i}`).trim() || "#FF6A1F");
  const key = tok[0] + tok[3];
  if (rampCache?.key === key) return rampCache.data;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 1;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 256, 0);
  [0, 0.35, 0.7, 1].forEach((stop, i) => grad.addColorStop(stop, tok[i]));
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 1);
  rampCache = { key, data: g.getImageData(0, 0, 256, 1).data };
  return rampCache.data;
}

export function drawHeat(canvas: HTMLCanvasElement, pts: HeatPoint[], vb: ViewBox, fullW: number) {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
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
  const stamp = document.createElement("canvas");
  stamp.width = stamp.height = Math.ceil(R * 2);
  const sx = stamp.getContext("2d")!;
  const g = sx.createRadialGradient(R, R, 0, R, R, R);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  sx.fillStyle = g;
  sx.fillRect(0, 0, 2 * R, 2 * R);
  for (const p of pts) {
    const x = (p.x - vb.x) * s, y = (p.y - vb.y) * s;
    if (x < -R || y < -R || x > cw + R || y > ch + R) continue;
    o.globalAlpha = p.bakery ? ALPHA_BAKERY : ALPHA;
    o.drawImage(stamp, x - R, y - R);
  }
  const img = o.getImageData(0, 0, cw, ch);
  const d = img.data, r = ramp(canvas);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (!a) continue;
    const j = Math.min(255, a) * 4;
    d[i] = r[j];
    d[i + 1] = r[j + 1];
    d[i + 2] = r[j + 2];
    d[i + 3] = Math.min(MAX_ALPHA, 40 + a * 1.4);
  }
  ctx.putImageData(img, 0, 0);
}
