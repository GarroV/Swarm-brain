// Мастер-админ по данным (#233): `AdminActor.isMaster` даёт объём суперадмина человеку из
// `master_admins`; без флага и у обычного админа результат прежний. Ядро прав — тесты до кода.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  canChangeAccountKeys,
  canManageMember,
  canManageWorkspace,
  isSuperadmin,
  SUPERADMIN_TELEGRAM_ID,
} from "./admin-scope.ts";

const CONSTANT = { telegramId: SUPERADMIN_TELEGRAM_ID, groupId: "cee" };
const MASTER_FROM_DATA = { telegramId: 555, groupId: "cee", isMaster: true };
const ADMIN = { telegramId: 1001, groupId: "cee" };
const ADMIN_FLAGGED_OFF = { telegramId: 1001, groupId: "cee", isMaster: false };

Deno.test("isSuperadmin: константа без флага — да, как раньше", () => {
  assert(isSuperadmin(CONSTANT));
});

Deno.test("isSuperadmin: константа с флагом false всё равно мастер (константа не снимается флагом)", () => {
  assert(isSuperadmin({ ...CONSTANT, isMaster: false }));
});

Deno.test("isSuperadmin: человек из master_admins (не константа) — да", () => {
  assert(isSuperadmin(MASTER_FROM_DATA));
});

Deno.test("isSuperadmin: обычный админ — нет, с флагом и без", () => {
  assert(!isSuperadmin(ADMIN));
  assert(!isSuperadmin(ADMIN_FLAGGED_OFF));
});

Deno.test("объём: мастер из данных управляет любым пространством и участником, админ — только своим", () => {
  const other = { telegram_id: 3001, group_id: "other" };
  assert(canManageWorkspace(MASTER_FROM_DATA, "other"));
  assert(canManageMember(MASTER_FROM_DATA, other));
  assert(!canManageWorkspace(ADMIN, "other"));
  assert(!canManageMember(ADMIN, other));
  assert(canManageWorkspace(ADMIN, "cee"));
});

Deno.test("аккаунт константного суперадмина: мастер из данных меняет, обычный админ — нет", () => {
  const row = { telegram_id: SUPERADMIN_TELEGRAM_ID, group_id: "cee" };
  assertEquals(canChangeAccountKeys(MASTER_FROM_DATA, row), true);
  assertEquals(canChangeAccountKeys(ADMIN, row), false);
});
