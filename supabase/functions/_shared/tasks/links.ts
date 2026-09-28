// Ссылки у задачи: разбор и проверка на входе.
//
// Поле пользовательское и рисуется как <a href>, поэтому схему проверяем явным списком, а не
// «лишь бы парсилось»: `javascript:alert(1)` — валидный URL с точки зрения конструктора, но в
// href это выполнение чужого кода. Правила взяты у Plane (`IssueLink`): валидный адрес, только
// http/https, повтор одного адреса у одной задачи не добавляется; лимит — наш (D008).

/** Больше двадцати ссылок у одной задачи — это уже не задача, а папка. */
export const LINKS_MAX = 20;
/** Название длиннее двухсот знаков ломает строку в интерфейсе; режем, но ссылку не теряем. */
export const LINK_TITLE_MAX = 200;

const ALLOWED_PROTOCOLS = ["http:", "https:"] as const;

export interface TaskLink {
  title: string | null;
  url: string;
}

function checkUrl(raw: string, at: number): string {
  const url = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `Ссылка ${at}: ${
        JSON.stringify(raw)
      } — не адрес. Нужен полный адрес, начинающийся с http:// или https://`,
    );
  }
  if (
    !(ALLOWED_PROTOCOLS as readonly string[]).includes(
      parsed.protocol.toLowerCase(),
    )
  ) {
    throw new Error(
      `Ссылка ${at}: принимаются только адреса http:// и https://, а пришло ${
        JSON.stringify(raw)
      }`,
    );
  }
  return url;
}

function checkTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const title = raw.trim();
  if (title === "") return null;
  return title.length > LINK_TITLE_MAX ? title.slice(0, LINK_TITLE_MAX) : title;
}

/**
 * Разбирает поле `links` из тела запроса. Бросает с указанием номера негодной ссылки —
 * человеку надо понять, какую из двадцати чинить.
 */
export function parseLinks(input: unknown): TaskLink[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    throw new Error("Ссылки передаются списком");
  }
  if (input.length > LINKS_MAX) {
    throw new Error(
      `Слишком много ссылок: ${input.length}, принимается не больше ${LINKS_MAX}`,
    );
  }

  const out: TaskLink[] = [];
  const seen = new Set<string>();

  input.forEach((raw, i) => {
    const at = i + 1;
    let url: string;
    let title: string | null;

    if (typeof raw === "string") {
      url = checkUrl(raw, at);
      title = null;
    } else if (
      raw && typeof raw === "object" &&
      typeof (raw as TaskLink).url === "string"
    ) {
      url = checkUrl((raw as TaskLink).url, at);
      title = checkTitle((raw as TaskLink).title);
    } else {
      throw new Error(
        `Ссылка ${at}: ожидается адрес строкой или объект {url, title}, а пришло ${typeof raw}`,
      );
    }

    // Повтор не добавляем, но и не считаем ошибкой: человек мог вставить один адрес дважды,
    // и ронять из-за этого сохранение задачи — грубость.
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ title, url });
  });

  return out;
}
