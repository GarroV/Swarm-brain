import type { ReactNode } from "react";

// Превращает голый текст в React-ноды: URL (http/https) → кликабельная ссылка, остальное — текст.
// Безопасно: строим ноды, БЕЗ dangerouslySetInnerHTML; регекс матчит только http(s):// → href не может
// стать javascript:/data:. Ссылки открываются в новой вкладке с rel="noopener noreferrer".
// stopPropagation — чтобы клик по ссылке в комменте/модалке не всплывал в родительские обработчики.
const URL_RE = /(https?:\/\/[^\s<]+)/gi;

// Хвостовая пунктуация не входит в URL (точка/запятая/скобка в конце предложения).
function trimTrailing(url: string): { url: string; tail: string } {
  const m = url.match(/[),.;:!?'"»\]]+$/);
  if (!m) return { url, tail: "" };
  return { url: url.slice(0, url.length - m[0].length), tail: m[0] };
}

export function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const { url, tail } = trimTrailing(m[0]);
    out.push(
      <a
        key={key++}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="break-all text-[var(--accent-ink)] underline underline-offset-2"
      >
        {url}
      </a>,
    );
    if (tail) out.push(tail);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
