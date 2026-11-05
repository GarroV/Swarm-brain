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
    /mayJoinExisting\(identity, myEmail, row, scope\) && mayJoinAcrossWorkspaces\(identity\.groupId, row, scope\)/.test(
      src,
    ),
    "mayJoin в meeting-claim не зовёт mayJoinAcrossWorkspaces — человек из другого пространства встанет в строку по одному ключу",
  );
  assert(
    src.includes('"id, group_id, identity_kind, identity_key, identity_verified,'),
    "EXISTING_COLUMNS без group_id/identity_verified — правило пространств слепо",
  );
});

Deno.test("claim: признак подтверждения ставит только сервер, из календаря по resolveAgentScope", () => {
  const src = squash(read("meeting-claim/index.ts"));
  assert(
    src.includes("const identityVerified = serverVerifiedCalendarKey(scopedKey, scope);"),
    "identity_verified считается не из серверного календаря",
  );
  assert(src.includes("identity_verified: identityVerified,"), "основная вставка строки без identity_verified");
  assert(!/identity_verified:\s*body\./.test(src), "identity_verified берётся из тела запроса клиента");
  assert(src.includes("if (hasWorkspaceTag(b.identity_key))"), "клиентский ключ с меткой пространства не отклоняется");
});

Deno.test("claim: неподтверждённая чужая строка — своя строка своего пространства, а не 403", () => {
  const src = squash(read("meeting-claim/index.ts"));
  assert(
    src.includes(
      "const crossRefused = keyRow.group_id !== identity.groupId && !mayJoinAcrossWorkspaces(identity.groupId, keyRow, scope);",
    ),
    "в ветке 23505 нет решения о чужой строке",
  );
  assert(
    src.includes("const target = crossRefused ? await claimOwnWorkspaceRow(") &&
      src.includes("workspaceScopedKey(scopedKey, identity.groupId)"),
    "при отказе в чужой строке запись не кладётся в свою строку с ключом пространства",
  );
  assert(
    src.includes("if (!found || found.group_id !== groupId)"),
    "своя строка по ключу пространства не сверяется с пространством",
  );
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
