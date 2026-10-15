// Экранирование текста для сообщений Telegram с parse_mode: HTML.
// Названия, имена и ответы модели приходят от людей и из внешних источников: без экранирования
// «<» ломает разбор, а модель или автор текста может вставить собственную ссылку.

const AMP = /&/g;
const LT = /</g;
const GT = />/g;
const QUOT = /"/g;

// Для вставки произвольного текста в HTML-шаблон сообщения (в том числе в значение атрибута).
export function escapeHtml(s: string): string {
  return s.replace(AMP, "&amp;").replace(LT, "&lt;").replace(GT, "&gt;").replace(QUOT, "&quot;");
}

// Теги простого форматирования, которые разрешены в тексте от модели — только без атрибутов.
const ALLOWED_TAG = /&lt;(\/?)(b|i|u|s|code|pre)&gt;/gi;

// Для текста от модели: всё экранируется, затем возвращаются только голые <b> <i> <u> <s> <code>
// <pre> и их закрывающие пары. <a ...>, теги с атрибутами и любые прочие остаются видимым текстом.
// Теги, у которых нет пары (лишний закрывающий, незакрытый открывающий), тоже остаются текстом:
// Telegram отклоняет сообщение с несбалансированной разметкой целиком.
export function sanitizeModelHtml(s: string): string {
  const escaped = escapeHtml(s).replace(/&quot;/g, '"');
  const parts = escaped.split(ALLOWED_TAG);
  // split с двумя группами: [текст, "/"|"", имя, текст, ...]
  const tokens: Array<{ text: string; tag?: string; closing?: boolean }> = [];
  for (let i = 0; i < parts.length; i += 3) {
    tokens.push({ text: parts[i] });
    if (i + 2 < parts.length) {
      tokens.push({ text: "", tag: parts[i + 2].toLowerCase(), closing: parts[i + 1] === "/" });
    }
  }
  const keep = new Set<number>();
  const stack: Array<{ tag: string; index: number }> = [];
  tokens.forEach((t, index) => {
    if (!t.tag) return;
    if (!t.closing) {
      stack.push({ tag: t.tag, index });
      return;
    }
    // Закрывающий тег сопоставляется только с ближайшим открытым тем же именем без «чужих» между ними.
    const top = stack[stack.length - 1];
    if (top && top.tag === t.tag) {
      stack.pop();
      keep.add(top.index);
      keep.add(index);
    }
  });
  return tokens
    .map((t, index) => {
      if (!t.tag) return t.text;
      if (keep.has(index)) return `<${t.closing ? "/" : ""}${t.tag}>`;
      return `&lt;${t.closing ? "/" : ""}${t.tag}&gt;`;
    })
    .join("");
}
