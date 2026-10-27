// Мастер-админ по данным (#233): `AdminActor.isMaster` даёт объём суперадмина человеку из
// `master_admins`; без флага и у обычного админа результат прежний. Ядро прав — тесты до кода.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  canChangeAccountKeys,
  canManageMember,
  canManageWorkspace,
  canSetLoginEmail,
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

Deno.test("аккаунт владельца (константа): меняет только он сам — не мастер из данных, не админ", () => {
  const row = { telegram_id: SUPERADMIN_TELEGRAM_ID, group_id: "cee" };
  assertEquals(canChangeAccountKeys(CONSTANT, row), true);
  assertEquals(canChangeAccountKeys(MASTER_FROM_DATA, row), false);
  assertEquals(canChangeAccountKeys(ADMIN, row), false);
});

Deno.test("аккаунт мастер-админа из данных (is_master): меняет только мастер-админ", () => {
  const row = { telegram_id: 555, group_id: "cee", is_master: true };
  assertEquals(canChangeAccountKeys(ADMIN, row), false);
  assertEquals(canChangeAccountKeys(ADMIN_FLAGGED_OFF, row), false);
  assertEquals(canChangeAccountKeys(MASTER_FROM_DATA, row), true);
  assertEquals(canChangeAccountKeys(CONSTANT, row), true);
});

Deno.test("обычный человек (is_master false или без признака): админ меняет, как раньше", () => {
  assertEquals(canChangeAccountKeys(ADMIN, { telegram_id: 20, group_id: "cee", is_master: false }), true);
  assertEquals(canChangeAccountKeys(ADMIN, { telegram_id: 20, group_id: "cee" }), true);
});

// Почта входа: ключ веб-входа (Google). Админ задаёт её только тому, кто ни разу не входил.
Deno.test("canSetLoginEmail: ожидающее приглашение своего воркспейса — админ может", () => {
  assert(canSetLoginEmail(ADMIN, { telegram_id: null, group_id: "cee" }));
});

Deno.test("canSetLoginEmail: приглашение чужого воркспейса — админ не может", () => {
  assert(!canSetLoginEmail(ADMIN, { telegram_id: null, group_id: "other" }));
});

Deno.test("canSetLoginEmail: тот, кто уже входил, — админ воркспейса не может", () => {
  assert(!canSetLoginEmail(ADMIN, { telegram_id: 2001, group_id: "cee" }));
});

Deno.test("canSetLoginEmail: человек сам себе — может", () => {
  assert(canSetLoginEmail(ADMIN, { telegram_id: ADMIN.telegramId, group_id: "cee" }));
});

Deno.test("canSetLoginEmail: мастер-админ тому, кто уже входил, — может", () => {
  assert(canSetLoginEmail(MASTER_FROM_DATA, { telegram_id: 2001, group_id: "other" }));
});

Deno.test("canSetLoginEmail: аккаунт владельца мастер-админ из данных не меняет", () => {
  assert(!canSetLoginEmail(MASTER_FROM_DATA, { telegram_id: SUPERADMIN_TELEGRAM_ID, group_id: "cee" }));
});
