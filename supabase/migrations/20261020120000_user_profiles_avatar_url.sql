-- Аватарка из Google-входа. Аддитивно (ADD COLUMN), старый код колонку не читает.
-- Пишет только auth-resolve по подписанному полю avatar_sig; принимаются https и *.googleusercontent.com.
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS avatar_url text;
COMMENT ON COLUMN public.user_profiles.avatar_url IS 'Фото профиля Google (userinfo.picture), обновляется при каждом входе';
