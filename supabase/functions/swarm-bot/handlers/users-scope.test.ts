import { assertEquals } from "jsr:@std/assert@1";
import {
  canActOnUser,
  canAddUsers,
  canAddUserTarget,
  canUseWorkspaceCommand,
  isEditableProfileField,
  type UsersActor,
} from "./users-scope.ts";
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

Deno.test("мастер-админ из master_admins действует в любом воркспейсе и добавляет людей", () => {
  const master: UsersActor = { telegramId: 555, groupId: "ws-a", isAdmin: true, isMaster: true };
  assertEquals(canActOnUser(master, stranger, "remove"), true);
  assertEquals(canActOnUser(admin, stranger, "view"), false);
  assertEquals(canActOnUser(admin, superRow, "edit"), false);
});

Deno.test("мастер-админ из данных как цель: админ воркспейса не правит и не убирает, мастер — может", () => {
  const master: UsersActor = { telegramId: 555, groupId: "ws-a", isAdmin: true, isMaster: true };
  const masterRow = { telegram_id: 777, group_id: "ws-a", is_master: true };
  assertEquals(canActOnUser(admin, masterRow, "edit"), false);
  assertEquals(canActOnUser(admin, masterRow, "remove"), false);
  assertEquals(canActOnUser(admin, masterRow, "view"), true);
  assertEquals(canActOnUser(master, masterRow, "remove"), true);
});

Deno.test("аккаунт владельца: мастер из данных его не правит", () => {
  const master: UsersActor = { telegramId: 555, groupId: "ws-a", isAdmin: true, isMaster: true };
  assertEquals(canActOnUser(master, superRow, "edit"), false);
  assertEquals(canActOnUser(superadmin, superRow, "edit"), true);
});

// /users add: существующая строка по telegram_id/username ПЕРЕМЕЩАЕТСЯ в воркспейс действующего.
Deno.test("/users add: админ добавляет нового человека (строки нет) и человека своего воркспейса", () => {
  assertEquals(canAddUserTarget(admin, null), true);
  assertEquals(canAddUserTarget(admin, colleague), true);
});

Deno.test("/users add: админ не переносит к себе человека из чужого воркспейса", () => {
  assertEquals(canAddUserTarget(admin, stranger), false);
});

Deno.test("/users add: админ не трогает аккаунт суперадмина и мастер-админа из данных", () => {
  assertEquals(canAddUserTarget(admin, superRow), false);
  assertEquals(canAddUserTarget(admin, { telegram_id: 40, group_id: "ws-a", is_master: true }), false);
});

Deno.test("/users add: участник без прав админа не добавляет никого", () => {
  assertEquals(canAddUserTarget(member, null), false);
});

Deno.test("/users add: суперадмин переносит человека из любого воркспейса", () => {
  assertEquals(canAddUserTarget(superadmin, stranger), true);
});

// /workspace: список всех воркспейсов, создание, перенос между воркспейсами — только суперадмин.
Deno.test("/workspace: админ воркспейса и участник — нет, суперадмин и мастер-админ из данных — да", () => {
  assertEquals(canUseWorkspaceCommand(admin), false);
  assertEquals(canUseWorkspaceCommand(member), false);
  assertEquals(canUseWorkspaceCommand(superadmin), true);
  assertEquals(canUseWorkspaceCommand({ telegramId: 555, groupId: "ws-a", isMaster: true }), true);
});
