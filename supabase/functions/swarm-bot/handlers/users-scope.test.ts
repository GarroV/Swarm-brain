import { assertEquals } from "jsr:@std/assert@1";
import { canActOnUser, canAddUsers, isEditableProfileField, type UsersActor } from "./users-scope.ts";
import { SUPERADMIN_TELEGRAM_ID } from "../../_shared/users/admin-scope.ts";

const admin: UsersActor = { telegramId: 10, groupId: "ws-a", isAdmin: true };
const member: UsersActor = { telegramId: 11, groupId: "ws-a", isAdmin: false };
const superadmin: UsersActor = { telegramId: SUPERADMIN_TELEGRAM_ID, groupId: "ws-a", isAdmin: true };

const colleague = { telegram_id: 20, group_id: "ws-a" };
const stranger = { telegram_id: 30, group_id: "ws-b" };
const superRow = { telegram_id: SUPERADMIN_TELEGRAM_ID, group_id: "ws-a" };

Deno.test("админ правит и убирает человека своего воркспейса", () => {
  assertEquals(canActOnUser(admin, colleague, "edit"), true);
  assertEquals(canActOnUser(admin, colleague, "remove"), true);
});

Deno.test("админ не трогает человека чужого воркспейса — даже посмотреть", () => {
  assertEquals(canActOnUser(admin, stranger, "view"), false);
  assertEquals(canActOnUser(admin, stranger, "edit"), false);
  assertEquals(canActOnUser(admin, stranger, "remove"), false);
});

Deno.test("участник без прав админа только смотрит коллег", () => {
  assertEquals(canActOnUser(member, colleague, "view"), true);
  assertEquals(canActOnUser(member, colleague, "edit"), false);
  assertEquals(canActOnUser(member, colleague, "remove"), false);
  assertEquals(canAddUsers(member), false);
});

Deno.test("аккаунт суперадмина админ воркспейса не правит и не убирает", () => {
  assertEquals(canActOnUser(admin, superRow, "view"), true);
  assertEquals(canActOnUser(admin, superRow, "edit"), false);
  assertEquals(canActOnUser(admin, superRow, "remove"), false);
});

Deno.test("суперадмин действует в любом воркспейсе", () => {
  assertEquals(canActOnUser(superadmin, stranger, "remove"), true);
  assertEquals(canAddUsers(superadmin), true);
});

Deno.test("строки нет — нет и прав", () => {
  assertEquals(canActOnUser(superadmin, null, "view"), false);
});

Deno.test("править можно только поля формы, не произвольную колонку", () => {
  const fields = { first_name: "Имя", phone: "Телефон" };
  assertEquals(isEditableProfileField(fields, "phone"), true);
  assertEquals(isEditableProfileField(fields, "telegram_id"), false);
  assertEquals(isEditableProfileField(fields, "toString"), false);
});
