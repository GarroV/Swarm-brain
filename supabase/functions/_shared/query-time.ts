// Детект временного окна в поисковом запросе → ISO-дата "since" (YYYY-MM-DD) для жёсткого
// фильтра свежести в RAG (match_entries_hybrid.filter_since). Возвращает null, если запрос не про
// период. Эвристика: лучше грубое окно, чем его отсутствие — временные запросы («за 2 недели»,
// «последние новости») иначе промахиваются мимо свежих записей (issue #17).
//
// Токенизация (а не regex с границами слов): JS `\b` ASCII-only и ломается на кириллице, а `\w*`
// цепляет единицы ВНУТРИ слов («дн» в «послед-ние»). Токены избавляют от обеих ловушек.

const NUM_WORDS: Record<string, number> = {
  "один": 1, "одну": 1, "одна": 1, "пара": 2, "пару": 2, "пары": 2, "две": 2, "два": 2,
  "три": 3, "четыре": 4, "пять": 5, "шесть": 6, "семь": 7,
  "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
};

// Единица времени → дней. Матчит ТОКЕН целиком (не подстроку).
function unitDays(t: string): number | null {
  if (/^(день|дня|дней|дн|day|days)$/.test(t)) return 1;
  if (/^(недел[а-яё]+|нед|week|weeks)$/.test(t)) return 7;      // неделя/недели/недель/неделю
  if (/^(месяц[а-яё]*|мес|month|months)$/.test(t)) return 30;
  if (/^(квартал[а-яё]*|quarter|quarters)$/.test(t)) return 90;
  if (/^(год|года|году|лет|year|years)$/.test(t)) return 365;
  return null;
}

// Обобщённая «свежесть» без явного периода → окно по умолчанию.
const GENERIC_RE = /(последн|свеж|недавн|recent|latest|что нового|апдейт|дайджест|новост)/;
const GENERIC_DAYS = 14;

export function detectQuerySinceDays(query: string): number | null {
  const q = (query ?? "").toLowerCase();
  const tokens = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const ud = unitDays(tokens[i]);
    if (ud == null) continue;
    // Множитель — предыдущий токен (цифра или слово-число), иначе 1.
    let n = 1;
    const prev = tokens[i - 1];
    if (prev) {
      if (/^\d+$/.test(prev)) n = parseInt(prev, 10);
      else if (NUM_WORDS[prev] != null) n = NUM_WORDS[prev];
    }
    return Math.min(Math.max(n * ud, 1), 365);
  }
  if (GENERIC_RE.test(q)) return GENERIC_DAYS;
  return null;
}

/** ISO-дата (YYYY-MM-DD) начала окна из запроса, либо null если запрос не про период. */
export function detectQuerySince(query: string, today: Date = new Date()): string | null {
  const days = detectQuerySinceDays(query);
  if (days == null) return null;
  const d = new Date(today.getTime() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}
