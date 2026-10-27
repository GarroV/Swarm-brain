// Детектор проводки прав в боте: чистые функции прав (users-scope.ts, meeting-confirm.ts) ничего
// не защищают, пока обработчики их не зовут. Тест читает исходники и держит, что зовут; самопроверка
// на испорченном тексте подтверждает, что детектор падает.
import { fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";
import { assertEquals } from "jsr:@std/assert@1";

const HERE = fromFileUrl(new URL(".", import.meta.url));

export function wiringProblems(src: { workspace: string; users: string; meetings: string }): string[] {
  const problems: string[] = [];
  if (!/canUseWorkspaceCommand\(/.test(src.workspace)) problems.push("workspace.ts не зовёт canUseWorkspaceCommand");
  if (!/canAddUserTarget\(/.test(src.users) || !/loadAddTarget\(/.test(src.users)) {
    problems.push("users.ts: /users add не проверяет адресата (loadAddTarget + canAddUserTarget)");
  }
  const mc = src.meetings.slice(src.meetings.indexOf('data.startsWith("mc_")'));
  if (!/meetingConfirmPatch\([\s\S]*?publishPrivate: true/.test(mc.slice(0, mc.indexOf('data.startsWith("met_")')))) {
    problems.push("ветка mc_ не зовёт meetingConfirmPatch с publishPrivate");
  }
  const tag = src.meetings.slice(src.meetings.indexOf('action.startsWith("meeting_tag_")'));
  if (!/entry_type, source/.test(tag) || !/isMeetingEntry\(/.test(tag)) {
    problems.push("meeting_tag_ не отсекает не-встречи (entry_type, source + isMeetingEntry)");
  }
  return problems;
}

async function read(name: string) {
  return await Deno.readTextFile(`${HERE}${name}`);
}

Deno.test("права проведены в обработчики бота: /workspace, /users add, mc_, meeting_tag_", async () => {
  const src = {
    workspace: await read("workspace.ts"),
    users: await read("users.ts"),
    meetings: await read("meetings.ts"),
  };
  assertEquals(wiringProblems(src), []);
});

Deno.test("детектор ловит каждую снятую проверку", async () => {
  const good = {
    workspace: await read("workspace.ts"),
    users: await read("users.ts"),
    meetings: await read("meetings.ts"),
  };
  const cut = (s: string, re: RegExp) => {
    const out = s.replace(re, "XX(");
    assertEquals(out !== s, true, "порча не применилась");
    return out;
  };
  assertEquals(wiringProblems({ ...good, workspace: cut(good.workspace, /canUseWorkspaceCommand\(/g) }).length, 1);
  assertEquals(wiringProblems({ ...good, users: cut(good.users, /canAddUserTarget\(/g) }).length, 1);
  assertEquals(wiringProblems({ ...good, meetings: cut(good.meetings, /publishPrivate: true/g) }).length, 1);
  const tagBroken = good.meetings.replace(
    /(action\.startsWith\("meeting_tag_"\)[\s\S]*?)isMeetingEntry\(/,
    "$1XX(",
  );
  assertEquals(tagBroken !== good.meetings, true);
  assertEquals(wiringProblems({ ...good, meetings: tagBroken }).length, 1);
});
