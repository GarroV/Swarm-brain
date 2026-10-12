-- Закрепить search_path у функций, на которые указывает линтер Supabase (function_search_path_mutable).
-- Без него функция ищет таблицы по search_path ВЫЗЫВАЮЩЕГО: для SECURITY DEFINER это значит, что
-- вызывающий может подложить свой объект с тем же именем во временную схему и исполнить его с
-- правами владельца функции. Сейчас EXECUTE у SECURITY DEFINER-функций только у service_role
-- (миграция 20260826210000), так что это защита в глубину, а не закрытие дыры.
--
-- generate_mcp_token / revoke_mcp_token кодом не вызываются (токены выпускает _shared/mcp-token.ts),
-- но не удаляются: правило «ничего не удаляем физически» и разбор их судьбы — отдельно.
-- Триггерную функцию глубины дерева в разделе «Проекты» не трогаем: это защищённый раздел
-- (.github/protected-paths.txt), правка только по прямой просьбе владельца.
ALTER FUNCTION public.generate_mcp_token(bigint) SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_mcp_token(integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.revoke_mcp_token(bigint) SET search_path = public, pg_temp;
ALTER FUNCTION public.revoke_mcp_token(integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at() SET search_path = public, pg_temp;
