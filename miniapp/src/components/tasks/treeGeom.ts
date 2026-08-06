// Чистая геометрия дерева проекта — вынесена из ProjectTree, чтобы покрыть тестами
// без флейки-симуляции drag в react-flow (RF-инпут через pointer/d3-drag ненадёжно
// воспроизводится синтетически). Здесь — только математика магнита и скорости жеста.

export type Rect = { x: number; y: number; w: number; h: number }; // x,y — верх-левый угол (мир)
export type Sample = { x: number; y: number; t: number };

// «радиус» карточки для нормализации магнита по размеру (корень крупнее задач)
export function approxRadius(w: number, h: number): number {
  return Math.max(w, h) / 2;
}

// Зазор между ГРАНЯМИ по линии центров: ~0 = карточки соприкасаются, <0 = перекрылись,
// >0 = между ними ещё пусто. Магнит смотрит на зазор, а не на дистанцию центров — иначе
// крупный корень ощущается «не липнет» (у него центр далеко даже при близких гранях).
export function edgeGap(a: Rect, b: Rect): number {
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
  const centerDist = Math.hypot(bcx - acx, bcy - acy);
  return centerDist - approxRadius(a.w, a.h) - approxRadius(b.w, b.h);
}

// Попадает ли b в зону магнита относительно a (порог по зазору граней).
export function withinMagnet(a: Rect, b: Rect, gapPx: number): boolean {
  return edgeGap(a, b) < gapPx;
}

// Усреднённая скорость жеста по скользящему окну (px/мс). Окно (а не последний кадр)
// гасит единичный джиттер трекпада перед отпусканием — иначе микро-дрожь давала ложный «рывок».
export function windowedSpeed(samples: Sample[], windowMs: number): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const within = samples.filter((s) => last.t - s.t <= windowMs);
  const first = within.length > 1 ? within[0] : samples[samples.length - 2];
  const dt = Math.max(8, last.t - first.t);
  return Math.hypot(last.x - first.x, last.y - first.y) / dt;
}
