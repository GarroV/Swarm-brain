-- One-time normalization of entries.countries and user_profiles.markets to ISO codes.

CREATE OR REPLACE FUNCTION _normalize_country_once(raw text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(trim(raw))
    WHEN 'сербия'        THEN 'RS' WHEN 'serbia'       THEN 'RS'
    WHEN 'хорватия'      THEN 'HR' WHEN 'croatia'      THEN 'HR'
    WHEN 'словения'      THEN 'SI' WHEN 'slovenia'     THEN 'SI'
    WHEN 'черногория'    THEN 'ME' WHEN 'montenegro'   THEN 'ME'
    WHEN 'болгария'      THEN 'BG' WHEN 'bulgaria'     THEN 'BG'
    WHEN 'испания'       THEN 'ES' WHEN 'spain'        THEN 'ES'
    WHEN '(испания)'     THEN 'ES'
    WHEN 'румыния'       THEN 'RO' WHEN 'romania'      THEN 'RO'
    WHEN 'польша'        THEN 'PL' WHEN 'poland'       THEN 'PL'
    WHEN 'эстония'       THEN 'EE' WHEN 'estonia'      THEN 'EE'
    WHEN 'литва'         THEN 'LT' WHEN 'lithuania'    THEN 'LT'
    WHEN 'кипр'          THEN 'CY' WHEN 'cyprus'       THEN 'CY'
    WHEN 'венгрия'       THEN 'HU' WHEN 'hungary'      THEN 'HU'
    WHEN 'молдова'       THEN 'MD' WHEN 'moldova'      THEN 'MD'
    WHEN 'беларусь'      THEN 'BY' WHEN 'belarus'      THEN 'BY'
    WHEN 'турция'        THEN 'TR' WHEN 'turkey'       THEN 'TR'
    WHEN 'азербайджан'   THEN 'AZ' WHEN 'azerbaijan'  THEN 'AZ'
    WHEN 'армения'       THEN 'AM' WHEN 'armenia'      THEN 'AM'
    WHEN 'грузия'        THEN 'GE' WHEN 'georgia'      THEN 'GE'
    WHEN 'таджикистан'   THEN 'TJ' WHEN 'tajikistan'   THEN 'TJ'
    WHEN 'кыргызстан'    THEN 'KG' WHEN 'kyrgyzstan'   THEN 'KG'
    WHEN 'монголия'      THEN 'MN' WHEN 'mongolia'     THEN 'MN'
    WHEN 'нигерия'       THEN 'NG' WHEN 'nigeria'      THEN 'NG'
    WHEN 'мексика'       THEN 'MX' WHEN 'mexico'       THEN 'MX'
    WHEN 'бали'          THEN 'ID' WHEN 'bali'         THEN 'ID'
    WHEN 'индонезия'     THEN 'ID' WHEN 'indonesia'    THEN 'ID'
    WHEN 'россия'        THEN 'RU' WHEN 'russia'       THEN 'RU'
    WHEN 'украина'       THEN 'UA' WHEN 'ukraine'      THEN 'UA'
    WHEN 'казахстан'     THEN 'KZ' WHEN 'kazakhstan'   THEN 'KZ'
    ELSE trim(raw)
  END;
$$;

UPDATE public.entries
SET countries = ARRAY(
  SELECT DISTINCT _normalize_country_once(c)
  FROM unnest(countries) c
  WHERE c IS NOT NULL AND trim(c) <> ''
)
WHERE array_length(countries, 1) > 0;

UPDATE public.user_profiles
SET markets = ARRAY(
  SELECT DISTINCT _normalize_country_once(m)
  FROM unnest(markets) m
  WHERE m IS NOT NULL AND trim(m) <> ''
)
WHERE array_length(markets, 1) > 0;

DROP FUNCTION IF EXISTS _normalize_country_once(text);
