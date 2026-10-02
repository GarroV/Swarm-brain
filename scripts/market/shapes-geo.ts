// Геометрия генератора карт стран (build-shapes.ts): проекция, обрезка по рамке, упрощение и
// запись в SVG-путь. Всё в пикселях итоговой карты, поэтому допуск упрощения — доля пикселя.

export type Proj = { K: number; L0: number; LAT0: number; CS: number };
export type Pt = [number, number];

/** Та же эквидистантная проекция, что у экрана (miniapp/src/lib/marketView.ts `project`). */
export const project = (p: Proj, lng: number, lat: number): Pt => [
  (lng - p.L0) * p.CS * p.K,
  (p.LAT0 - lat) * p.K,
];

/** Обрезка кольца прямоугольником (Сазерленд — Ходжман): соседняя страна целиком весила бы
 *  мегабайты, а на карте видна её кромка. */
export function clipRing(
  ring: Pt[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Pt[] {
  const edges: Array<[(p: Pt) => boolean, (a: Pt, b: Pt) => Pt]> = [
    [(p) => p[0] >= x0, (a, b) => cross(a, b, 0, x0)],
    [(p) => p[0] <= x1, (a, b) => cross(a, b, 0, x1)],
    [(p) => p[1] >= y0, (a, b) => cross(a, b, 1, y0)],
    [(p) => p[1] <= y1, (a, b) => cross(a, b, 1, y1)],
  ];
  let out = ring;
  for (const [inside, at] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const cur = src[i], prev = src[(i + src.length - 1) % src.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(at(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(at(prev, cur));
    }
    if (!out.length) return [];
  }
  return out;
}

function cross(a: Pt, b: Pt, axis: 0 | 1, v: number): Pt {
  const t = (v - a[axis]) / (b[axis] - a[axis]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Линия (река) → куски внутри рамки; на границе рамки кусок кончается. */
export function clipLine(
  line: Pt[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Pt[][] {
  const inside = (p: Pt) =>
    p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of line) {
    if (inside(p)) cur.push(p);
    else if (cur.length) {
      runs.push([...cur, p]);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r) => r.length > 1);
}

/** Дуглас — Пекер: точки, отклоняющиеся меньше `tol` пикселя, глаз всё равно не различит. */
export function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1, bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i], pts[a], pts[b]);
      if (d > bestD) [best, bestD] = [i, d];
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
    : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

const n = (v: number) => Math.round(v * 10) / 10;

/** Кольца → путь `M…Z`; совпадающие соседние точки после округления выбрасываются. */
export function toPath(rings: Pt[][], closed: boolean): string {
  return rings.map((r) => {
    const pts = r.map(([x, y]) => `${n(x)},${n(y)}`).filter((s, i, a) =>
      i === 0 || s !== a[i - 1]
    );
    return pts.length > 1 ? `M${pts.join("L")}${closed ? "Z" : ""}` : "";
  }).join("");
}
