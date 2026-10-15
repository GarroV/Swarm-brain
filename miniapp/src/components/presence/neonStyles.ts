// Пять неоновых обработок зверя (утверждённый макет 15.10: Трубка, Вывеска, Синтвейв, Кольцо,
// Стекло). Стиль не выбирается человеком, а выпадает вместе со зверем на окно в 4 часа
// (сервер отдаёт индекс 0..4, STYLE_COUNT в presence-pseudonyms.ts).
//
// Иконки — IconOven (MIT), автор Appic Marketing, https://iconoven.com (см. animals.ts).
import { ANIMAL_ICONS } from "./animals";

export const NEON_STYLE_COUNT = 5;

const NEON_PREFIX = "swarm-neon-";
const id = (name: string) => `${NEON_PREFIX}${name}`;

/** Неоновые цвета «Вывески», Кольца и Стекла: у каждого зверя свой. */
const HUES = ["#4FE3FF", "#FF4FD8", "#B6FF4F", "#FFB84F", "#A98BFF", "#FF5E6C", "#4FFFB8", "#FFE14F"] as const;
const hue = (animal: number) => HUES[animal % HUES.length];

/** Фильтры и градиенты — один раз на страницу (ensureNeonDefs), а не на каждый кружок. */
const NEON_DEFS = `<defs>
<filter id="${id("glow")}" x="-60%" y="-60%" width="220%" height="220%">
<feGaussianBlur in="SourceGraphic" stdDeviation="2.4" result="b1"/>
<feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b2"/>
<feMerge><feMergeNode in="b2"/><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
<filter id="${id("soft")}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="8"/></filter>
<linearGradient id="${id("synth")}" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#FF4FD8"/><stop offset="1" stop-color="#4FE3FF"/>
</linearGradient>
<radialGradient id="${id("glass")}" cx=".5" cy=".42" r=".62">
<stop offset="0" stop-color="#1D2B57"/><stop offset=".75" stop-color="#0B1230"/><stop offset="1" stop-color="#050816"/>
</radialGradient>
<radialGradient id="${id("wall")}" cx=".5" cy=".5" r=".7">
<stop offset="0" stop-color="#1A1420"/><stop offset="1" stop-color="#0B080F"/>
</radialGradient>
</defs>`;

const DEFS_HOST_ID = `${NEON_PREFIX}defs`;

/** Кладёт общие фильтры и градиенты в документ один раз (идемпотентно). Вызывать из эффекта. */
export function ensureNeonDefs(): void {
  if (typeof document === "undefined" || document.getElementById(DEFS_HOST_ID)) return;
  const host = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  host.setAttribute("id", DEFS_HOST_ID);
  host.setAttribute("width", "0");
  host.setAttribute("height", "0");
  host.setAttribute("aria-hidden", "true");
  host.style.position = "absolute";
  // Статическая константа этого файла; пользовательского ввода в ней нет.
  host.innerHTML = NEON_DEFS;
  document.body.appendChild(host);
}

/** Зверь 24x24 в круге 100x100: занимает центр. */
const icon = (animal: number, scale = 2.55): string =>
  `<g transform="translate(${50 - 12 * scale} ${50 - 12 * scale}) scale(${scale})">${ANIMAL_ICONS[animal]}</g>`;

/** Тонкая белая «сердцевина» трубки: та же иконка с тонкой линией. */
const thin = (animal: number, k: number): string =>
  icon(animal).replace(/stroke-width="([\d.]+)"/g, (_m, w: string) => `stroke-width="${(Number(w) * k).toFixed(2)}"`);

const disc = (fill: string) => `<circle cx="50" cy="50" r="50" fill="${fill}"/>`;

type Draw = (animal: number) => string;

const DRAW: readonly Draw[] = [
  // А. Трубка: фирменный голубой неон на тёмно-синем, белая сердцевина.
  (a) =>
    disc("#0A1630") +
    `<g filter="url(#${id("glow")})" style="color:#4FE3FF">${icon(a)}</g>` +
    `<g style="color:#E9FDFF" opacity=".9">${thin(a, 0.45)}</g>`,
  // Б. Вывеска: у каждого зверя свой цвет неона.
  (a) =>
    disc(`url(#${id("wall")})`) +
    `<g filter="url(#${id("glow")})" style="color:${hue(a)}">${icon(a)}</g>` +
    `<g style="color:#FFFFFF" opacity=".75">${thin(a, 0.4)}</g>`,
  // В. Синтвейв: градиент от розового к голубому по контуру и фиолетовая дымка.
  (a) =>
    disc("#170A2E") +
    `<circle cx="50" cy="70" r="34" fill="#FF4FD8" opacity=".35" filter="url(#${id("soft")})"/>` +
    `<g filter="url(#${id("glow")})" style="color:transparent">${
      icon(a).replace(/stroke="currentColor"/g, `stroke="url(#${id("synth")})"`)
    }</g>`,
  // Г. Кольцо: кружок — неоновая трубка, внутри зверь того же цвета.
  (a) =>
    disc("#0B0F1E") +
    `<g filter="url(#${id("glow")})" style="color:${hue(a)}"><circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="3.5"/>${
      icon(a, 2.15)
    }</g>`,
  // Д. Стекло: стеклянный шар, внутри мягко светится зверь.
  (a) =>
    disc(`url(#${id("glass")})`) +
    `<circle cx="50" cy="54" r="26" fill="${hue(a)}" opacity=".45" filter="url(#${id("soft")})"/>` +
    `<g style="color:#F4FBFF" filter="url(#${id("glow")})">${icon(a, 2.4)}</g>` +
    `<ellipse cx="40" cy="20" rx="22" ry="9" fill="#FFFFFF" opacity=".16"/>`,
];

const cache = new Map<number, string>();

/** Внутренняя разметка круга 100x100 для пары (зверь, стиль). Индексы вне набора — null. */
export function neonAvatarMarkup(animal: number, style: number): string | null {
  if (!Number.isInteger(animal) || !Number.isInteger(style)) return null;
  if (animal < 0 || animal >= ANIMAL_ICONS.length || style < 0 || style >= DRAW.length) return null;
  const key = animal * DRAW.length + style;
  let markup = cache.get(key);
  if (markup === undefined) {
    markup = DRAW[style](animal);
    cache.set(key, markup);
  }
  return markup;
}
