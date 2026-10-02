// Адрес веба для ссылок бота — одно место (issue #436). Раньше справка и Granola держали
// свою константу мимо env: при переезде веба на другой домен бот слал бы разные ссылки.
export const WEB_BASE_URL = Deno.env.get("WEB_BASE_URL") ?? "https://swarm-team.app";
