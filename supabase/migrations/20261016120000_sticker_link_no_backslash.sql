-- Ссылка стикера: обратный слеш запрещён. Браузер нормализует `\` в `/`, поэтому значение вида
-- `/\host` проходило прежний CHECK как «путь внутри приложения», а вело на чужой сайт.
-- Та же проверка — в коде (swarm-api/stickers-core.ts isSafeLink, miniapp/src/lib/stickers.ts).
--
-- NOT VALID: условие действует на каждую новую запись и правку сразу, а уже лежащие строки
-- накат не роняют (их отсев — делом кода при выдаче, safeStickerHref).
ALTER TABLE public.board_stickers
  ADD CONSTRAINT board_stickers_link_no_backslash
  CHECK (link IS NULL OR strpos(link, chr(92)) = 0) NOT VALID;
