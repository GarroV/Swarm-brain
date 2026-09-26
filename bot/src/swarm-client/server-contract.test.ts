/**
 * Контрактный тест со стороны потребителя: клиент бота и настоящий сервер не разъехались.
 *
 * Он читает исходники edge-функций и проверяет, что имена полей, пределы и заголовок
 * подмены личности — те самые, под которые написан `contract.ts`. Смысл именно в том,
 * что проверка смотрит на ЧУЖОЙ код: тест против собственного двойника сервера навсегда
 * останется зелёным, даже если сервер переименует поле, и молчаливо перестанет ловить
 * то единственное, ради чего он написан.
 *
 * Падает он громко и по делу: «сервер больше не ищет sys_parts» — это ровно та поломка,
 * из-за которой бот перестал бы отдавать запись, ничего при этом не сказав.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INGEST_FIELD, INGEST_PART_MAX_BYTES, PUBLISHED_STATUS } from "./contract.ts";

const read = (relative: string): string =>
  readFileSync(new URL(`../../../${relative}`, import.meta.url), "utf8");

const ingest = read("supabase/functions/meeting-ingest/index.ts");
const claim = read("supabase/functions/meeting-claim/index.ts");
const status = read("supabase/functions/meeting-status/index.ts");
const heartbeat = read("supabase/functions/meeting-heartbeat/write.ts");
const agentAuth = read("supabase/functions/_shared/agent-auth.ts");
const plan = read("docs/furca/plan.md");
const invite = read("supabase/functions/meeting-invite/index.ts");
const agentScope = read("supabase/functions/meeting-claim/agent-scope.ts");

describe("meeting-ingest", () => {
  it("принимает встречу по полю meeting_id", () => {
    expect(ingest).toContain(`formData.get("${INGEST_FIELD.meetingId}")`);
  });

  it.each([INGEST_FIELD.systemManifest, INGEST_FIELD.micManifest])(
    "манифест дорожки называется %s",
    (field) => {
      expect(ingest).toContain(`"${field}"`);
    },
  );

  it("манифест — это [{name, offset}], а файлы ищутся по name", () => {
    expect(ingest).toContain("formData.get(name)");
    expect(ingest).toContain("const offset = Number(item?.offset)");
  });

  it("предел части — тот же, на который клиент проверяет её при укладке", () => {
    expect(ingest).toContain(
      `const OPENAI_AUDIO_MAX_BYTES = ${String(INGEST_PART_MAX_BYTES / 1024 / 1024)} * 1024 * 1024`,
    );
  });

  it("аудио льёт только держатель права транскрибации", () => {
    expect(ingest).toContain("not the transcription owner for this meeting");
  });
});

describe("meeting-claim", () => {
  it("решение арбитража — ровно два значения", () => {
    expect(claim).toContain('type ClaimDecision = "transcribe" | "defer"');
  });

  it("в ответе есть всё, на что смотрит клиент", () => {
    for (const field of ["meeting_id", "decision", "lease_ttl_sec", "held_by", "held_by_name"]) {
      expect(claim).toContain(field);
    }
  });
});

describe("meeting-status", () => {
  it("встречи спрашиваются пачкой через ?ids=", () => {
    expect(status).toContain('searchParams.get("ids")');
  });

  it("отдаёт статусы списком statuses", () => {
    expect(status).toContain("statuses:");
  });

  it("публикация в базу помечается тем статусом, по которому очередь отпускает бэкап", () => {
    expect(status).toContain("id, summary_status, status");
    expect(read("recorder/Sources/SwarmRecorder/SwarmClient.swift")).toContain(
      `it.status == "${PUBLISHED_STATUS}"`,
    );
  });
});

describe("meeting-heartbeat", () => {
  it.each(["recording", "version", "on_call", "meeting_key", "meeting_id"])(
    "принимает поле %s",
    (field) => {
      expect(heartbeat).toContain(`${field}?: unknown`);
    },
  );
});

describe("подмена личности", () => {
  it("заголовок называется так же, как его шлёт клиент", () => {
    expect(agentAuth).toContain('export const ON_BEHALF_OF_HEADER = "X-On-Behalf-Of"');
  });

  it("токен служебного агента без него не даёт прав — на этом стоит приватность", () => {
    expect(agentAuth).toContain("service agent token grants nothing on its own");
  });
});

describe("таймлайн говорящих", () => {
  it("контракт поля speakers зафиксирован в техплане", () => {
    expect(plan).toContain("поле speakers формы meeting-ingest");
  });

  it("сервер, когда научится его принимать, читает его из формы под тем же именем", () => {
    // Приём `speakers` делает соседний блок (ingest-speakers, T030). Пока поля нет —
    // проверять нечего; как только появится, оно обязано читаться из формы как
    // `speakers`, иначе таймлайн уедет в пустоту и никто этого не заметит.
    const hasSpeakersField = ingest.includes("speakers");
    expect(
      hasSpeakersField ? ingest.includes(`formData.get("${INGEST_FIELD.speakers}")`) : true,
    ).toBe(true);
  });
});

describe("приглашения бота (D017)", () => {
  it("meeting-invite отдаёт ровно те поля, что разбирает клиент", () => {
    // Порядок и состав — как в MeetingInvite; поле, пропавшее у сервера, клиент отложит
    // в malformed, и бот молча не придёт на встречу.
    expect(invite).toContain(
      'const COLUMNS = "id, invited_by, join_url, platform, created_at, expires_at"',
    );
    expect(invite).toContain("json({ ok: true, invites })");
  });

  it("meeting-invite — дверь агента без подмены личности", () => {
    expect(invite).toContain("resolveServiceAgent(supabase, req)");
    expect(agentAuth).toContain("is not accepted by this endpoint");
  });

  it("предел limit клиент шлёт в теле под тем же именем", () => {
    expect(invite).toContain(".limit;");
  });

  it("заявка по приглашению читает invite_id и join_url", () => {
    expect(agentScope).toContain("invite_id?: unknown");
    expect(agentScope).toContain("join_url?: unknown");
    expect(agentScope).toContain("body.invite_id");
    expect(agentScope).toContain("body.join_url");
  });
});
