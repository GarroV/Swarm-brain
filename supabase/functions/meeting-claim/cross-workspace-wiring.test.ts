// Детектор: строка `meetings` ДРУГОГО пространства (склейка общей встречи, решение 05.11.2026)
// доступна только подтверждённому участнику. Сами правила покрыты тестами `mayJoinAcrossWorkspaces`
// (agent-scope.test.ts) и `canAccessDraftMeeting` (_shared/meeting-access.test.ts); обработчики без
// базы не поднять, поэтому подключение правил держится по исходнику.
import { fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";
import { assert } from "jsr:@std/assert@1";

const FN = fromFileUrl(new URL("..", import.meta.url));
const read = (rel: string) => Deno.readTextFileSync(FN + rel);
const squash = (s: string) => s.replace(/\s+/g, " ");

Deno.test("claim: встать в найденную строку пускают и правило агента, и правило пространств", () => {
  const src = squash(read("meeting-claim/index.ts"));
  assert(
    /mayJoinExisting\(identity, myEmail, row, scope\) && mayJoinAcrossWorkspaces\(identity\.groupId, myEmail, row, scope\)/
      .test(src),
    "mayJoin в meeting-claim не зовёт mayJoinAcrossWorkspaces — человек из другого пространства встанет в строку по одному ключу",
  );
  assert(src.includes('"id, group_id, identity_kind'), "EXISTING_COLUMNS без group_id — правило пространств слепо");
});

Deno.test("веб: список и карточка черновика проверяют доступ с e-mail смотрящего", () => {
  const src = squash(read("swarm-api/index.ts"));
  assert(
    src.includes("canAccessDraftMeeting(r as DraftMeetingRow, telegram_id, isAdmin, groupId, userEmail)"),
    "GET /agent-meetings не фильтрует строки другого пространства по составу встречи",
  );
  assert(
    /canAccessDraftMeeting\( meeting as DraftMeetingRow \| null, telegram_id, isAdmin, groupId, userEmail, \)/.test(
      src,
    ),
    "карточка /agent-meetings/:id проверяет доступ без e-mail смотрящего",
  );
});

Deno.test("MCP: черновик и очередь проверяют доступ с e-mail вызывающего", () => {
  const src = squash(read("swarm-mcp/meetings.ts"));
  assert(
    /canAccessDraftMeeting\( meeting as DraftMeetingRow, callerId, .*?, groupId, email, \)/.test(src),
    "loadOwnDraft без e-mail",
  );
  assert(
    src.includes("canAccessDraftMeeting(r, callerId, false, groupId, email)"),
    "очередь вычитки MCP без проверки строк",
  );
});
