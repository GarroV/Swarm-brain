-- Additive compatibility: old writers/readers retain cost_usd and its original type.
-- No historical amounts are recomputed; missing precise values fall back to cost_usd.
alter table public.model_usage
  add column if not exists cost_usd_precise numeric(20, 12);

comment on column public.model_usage.cost_usd_precise is
  'Recorded USD amount at call time, with 12 fractional digits and the same 8 integer digits as cost_usd. NULL on legacy rows or unknown prices; readers fall back to cost_usd.';

-- Readers/writers must see the new column in the API schema before their rollout.
notify pgrst, 'reload schema';
