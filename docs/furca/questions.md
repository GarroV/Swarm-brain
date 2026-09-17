<!-- managed by furca: do not change the row format below — fabrica and cursus parse this file -->
# Questions for the owner

<!-- id: Qnnn (Q001, Q002, ...). status: open (waiting for an answer) | answered (the answer is in the "answer" column) | auto (decided autonomously by the dispatcher; the "answer" column holds a reference of the form "→ Dnnn" into decisions.md). "blocks" — task ids from tasks.md, comma-separated, or "—". -->
<!-- The last line of the "question" column carries the note "sent YYYY-MM-DD". Without it "the question is written down" and "the question was asked" are indistinguishable, and the next session either asks it a second time or waits for an answer the owner never promised, because the owner never saw the question. -->

| id | status | blocks | question | answer |
|---|---|---|---|---|
| Q001 | answered | T101,T102 | Заводим боту собственный Google-аккаунт и добавляем его в календарные приглашения встреч? Исследование 17.09 закрыло сам факт: по документации Workspace анонимный гость входит без ручного допуска ТОЛЬКО если он есть в приглашении И идут первые 15 минут встречи; иначе дверь открывает человек. Значит «гостем по ссылке» из спеки — не рабочий режим, а постоянное ожидание у двери. Решение владельца нужно по двум пунктам: (1) завести аккаунт, (2) кто и как добавляет бота в приглашения — вручную или автоматикой по календарю. | → D004 (проверяем на своих встречах, аккаунт позже) sent 2026-09-17 |
| Q002 | open | T001 | Чем восстановить доступ к прод-базе Swarm? MCP-коннектор Supabase отвечает Unauthorized, `supabase` CLI проекта Swarm не видит (только Vault23 и PROMUS). Без чтения прода нечем сделать замер влияния разметки говорящих на тезисы. | — |
| Q003 | open | — | Как назвать бота? Рекордер зовётся `bumblebee`; §12 спеки оставляет имя за владельцем. Стройку не блокирует — в коде до выбора нейтральное `meeting-bot`. | — |
| Q004 | open | — | Пока бот и `bumblebee` пишут одну встречу параллельно, аудио оплачивается в OpenAI дважды. Терпим на время проверки или отбраковывать дубль до транскрибации? Связано с #311, #312. | → D006 (терпим на время проверки) sent 2026-09-17 |
| Q005 | open | T001 | Отдаёт ли Google Meet отдельный аудиоэлемент на каждого участника — или один сведённый поток? От этого зависит выполнимость решения D005 (дорожка на участника). Vexa делает именно так, но её код проверен на её версии вёрстки, а не на нашей. Проверяется разведкой на 2-3 часа ДО того, как под D005 перестраивать приём аудио на сервере. Ответ «один поток» вернёт нас к миксу и сэкономит 2-3 дня переделки meeting-processor. | — |
