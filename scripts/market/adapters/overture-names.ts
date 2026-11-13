// Имена и области Overture (#1113): согласие названия с брендом, склейка ключей одной сети и
// страновые исключения по контуру. Чистые функции без сети — их проверяет overture.test.ts.

// Апострофы убираем до NFKD: «´» (U+00B4) он раскладывает в пробел с акцентом, и «Roma´s» стало бы «Roma s».
const fold = (s: string) =>
  s.replace(/[’‘´`']/g, "").normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase();

/** Слова названия: без диакритики и апострофов («Domino's» → «dominos»), по небуквенным разделителям. */
export const tokens = (s: string): string[] =>
  fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Слова, по которым сеть не отличить от другой («pizza», «кофе», артикли): сами по себе не имя. */
const GENERIC = new Set(
  [
    "pizza",
    "pizzeria",
    "pizzas",
    "pica",
    "pizzu",
    "kebab",
    "doner",
    "coffee",
    "cafe",
    "caffe",
    "kawiarnia",
    "restaurant",
    "restoran",
    "bar",
    "grill",
    "sushi",
    "burger",
    "bakery",
    "bakeries",
    "bistro",
    "food",
    "house",
    "shop",
    "the",
    "and",
    "of",
    "cream",
    "ice",
    "la",
    "le",
    "el",
    "de",
    "пицца",
    "пиццерия",
    "кофе",
    "кофейня",
    "кофеен",
    "кафе",
    "сеть",
    "сети",
    "столовая",
    "ресторан",
    "суши",
    "бар",
    "гриль",
    "пекарня",
    "булочная",
    "trattoria",
    "osteria",
    "taverna",
    "tavern",
    "pub",
    "steakhouse",
    "piekarnia",
    "cukiernia",
    "kavine",
    "kebap",
    "panaderia",
    "pasteleria",
    "heladeria",
    "cerveceria",
    "restaurante",
    "cafeteria",
    "boulangerie",
    "patisserie",
    "etterem",
    "pekseg",
    "cukraszda",
    "fagyizo",
    "kafe",
    "kavarna",
    "kofejnja",
  ],
);
const isDistinctive = (t: string) => t.length >= 3 && !GENERIC.has(t);
const script = (t: string) =>
  /\p{Script=Latin}/u.test(t)
    ? "L"
    : /\p{Script=Cyrillic}/u.test(t)
    ? "C"
    : "O";

/** Слова вида заведения: название, в котором одно такое слово и нет бренда, — другое заведение того же вида. */
const KIND = new Set(
  [
    "pizza",
    "pizzeria",
    "pizzas",
    "pica",
    "kebab",
    "doner",
    "coffee",
    "cafe",
    "caffe",
    "kawiarnia",
    "restaurant",
    "restoran",
    "burger",
    "bakery",
    "bistro",
    "sushi",
    "grill",
    "пицца",
    "пиццерия",
    "кофе",
    "кофейня",
    "кафе",
    "ресторан",
    "суши",
    "гриль",
  ],
);

/** Название заведения не противоречит бренду, который на нём записан. Overture приписывает чужим
 *  заведениям бренд соседа: в PL под «Domino's Pizza» стоят «Pizza Dominium», «Domino Pizza Włoska»,
 *  «Crazy Piramid Pizza». Противоречие — это когда в названии нет слов бренда И (оно называет
 *  себя заведением того же вида, «Pizza …», «… Coffee», либо повторяет начало бренда с другим
 *  окончанием). Остальные несовпадения — не повод: Costa в ТЦ и на вокзалах называется по месту
 *  («Bonarka City Center», «PKP Szczecin») и остаётся Costa. Судить нечем (названия нет, у бренда
 *  нет отличительных слов, письменность названия иная) — считаем, что не противоречит. */
export function nameFitsBrand(name: string | null, brand: string): boolean {
  if (!name) return true;
  const distinct = tokens(brand).filter(isDistinctive);
  if (!distinct.length) return true;
  const own = new Set(tokens(name));
  // «Coffeeisland», «SecondCup»: слитное написание названия.
  if ([...own].join("").includes(distinct.join(""))) return true;
  // Судим только в письменности первого отличительного слова бренда: «Domino's Pizza Беларусь» на
  // кириллическом названии («Минск, Рафиева, 64») — не повод отбрасывать бренд.
  const head = distinct[0];
  if (![...own].some((t) => script(t) === script(head))) return true;
  if (distinct.some((t) => own.has(t))) return true;
  const lookalike = head.length >= 5 &&
    [...own].some((t) => t.length >= 5 && t.slice(0, 5) === head.slice(0, 5));
  return !(lookalike || [...own].some((t) => KIND.has(t)));
}

const commonPrefix = (a: string[], b: string[]) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

/** Две подписи — одна сеть, если одна является началом другой по словам («Nravizza» и
 *  «Nravizza Pizza», «DONER KING» и «DONER KING Belarus») либо у них общие первые два слова
 *  («Kawacom's Ipanema Espresso Kiti» и «… Lakatamias», «La Croissanterie France» и «… - Cyprus»).
 *  В общем начале нужно отличительное слово: «Pizza Mia» и «Pizza Mine» — разные сети. */
export function sameBrandRoot(a: string[], b: string[]): boolean {
  const p = commonPrefix(a, b);
  if (!p || !a.slice(0, p).some(isDistinctive)) return false;
  if (p >= 2) return true;
  // Один общий корень, когда подпись целиком равна ему: достаточно длинный, чтобы не быть именем («Tony»).
  return (p === a.length || p === b.length) && a[0].length >= 5;
}

/** Первое слово, общее для большего числа подписей, считается словом вида заведения. */
const MAX_SHARED_HEAD = 4;

/** Подписи → кластеры одной сети (индексы). Перебор внутри первого слова. */
export function clusterByRoot(labels: string[][]): number[][] {
  const parent = labels.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  // Бакет — первое отличительное слово: артикль («La Croissanterie») бакетом быть не должен.
  const byFirst = new Map<string, number[]>();
  labels.forEach((l, i) => {
    const head = l.find(isDistinctive);
    if (head) byFirst.set(head, [...(byFirst.get(head) ?? []), i]);
  });
  for (const bucket of byFirst.values()) {
    // Первое слово у многих разных подписей («Piekarnia …», «Kavinė …», «Taverna …») — это вид
    // заведения, а не имя сети: не склеиваем.
    if (bucket.length > MAX_SHARED_HEAD) continue;
    for (let x = 0; x < bucket.length; x++) {
      for (let y = x + 1; y < bucket.length; y++) {
        if (sameBrandRoot(labels[bucket[x]], labels[bucket[y]])) {
          parent[find(bucket[y])] = find(bucket[x]);
        }
      }
    }
  }
  const out = new Map<number, number[]>();
  labels.forEach((_, i) => out.set(find(i), [...(out.get(find(i)) ?? []), i]));
  return [...out.values()];
}

/** Название кластера: общее начало всех подписей, взятое из исходного написания самой частой из них;
 *  если общего начала нет (кластер из одной подписи) — сама подпись. */
export function clusterName(labels: string[], counts: number[]): string {
  const tok = labels.map(tokens);
  const n = tok.reduce(
    (m, t) => Math.min(m, commonPrefix(tok[0], t)),
    tok[0].length,
  );
  const top = labels[counts.indexOf(Math.max(...counts))];
  if (n === 0 || n === tokens(top).length) return top;
  const words: string[] = [];
  let seen = 0;
  for (const w of top.split(/\s+/)) {
    const k = tokens(w).length;
    if (!k) continue;
    if (seen + k > n) break;
    words.push(w);
    seen += k;
    if (seen === n) break;
  }
  return seen === n ? words.join(" ") : top;
}

export type Ring = Array<[number, number]>;

/** Точка (lng, lat) внутри кольца — чётно-нечётное правило. */
export function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (
      (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}
