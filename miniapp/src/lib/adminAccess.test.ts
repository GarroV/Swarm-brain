// Кто что видит в админке (#233). Права решает сервер; здесь — какие входы показывает экран.
// Раннер: deno test -A --no-check src/lib/ (bare specifier из deno.json).
import { assertEquals } from "@std/assert";
import {
  type AdminViewer,
  canCreateWorkspace,
  canSeeKeyHealth,
  canSeeMasterSection,
  canSetWorkspaceAdmin,
} from "./adminAccess.ts";

const master: AdminViewer = { is_admin: true, is_superadmin: true };
const wsAdmin: AdminViewer = { is_admin: true, is_superadmin: false };
const member: AdminViewer = { is_admin: false, is_superadmin: false };
const demoAdmin: AdminViewer = { is_admin: true, is_demo: true };

Deno.test("раздел мастер-админа (все пространства, роли мастера, расход системы) — только мастеру", () => {
  assertEquals(canSeeMasterSection(master), true);
  assertEquals(canSeeMasterSection(wsAdmin), false);
  assertEquals(canSeeMasterSection(member), false);
  assertEquals(canSeeMasterSection(null), false);
  assertEquals(canSeeMasterSection({}), false);
});

Deno.test("создавать пространства и назначать их админов — только мастер", () => {
  for (const f of [canCreateWorkspace, canSetWorkspaceAdmin]) {
    assertEquals(f(master), true);
    assertEquals(f(wsAdmin), false);
    assertEquals(f(member), false);
  }
});

Deno.test("баннер сбоя ключа — админу пространства и мастеру; не участнику и не демо", () => {
  assertEquals(canSeeKeyHealth(master), true);
  assertEquals(canSeeKeyHealth(wsAdmin), true);
  assertEquals(canSeeKeyHealth(member), false);
  assertEquals(canSeeKeyHealth(demoAdmin), false);
  assertEquals(canSeeKeyHealth(null), false);
});
