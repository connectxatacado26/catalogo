-- Adiciona campos de pack e integração Tiny ERP.
-- Rode no SQL Editor do Supabase: Dashboard > SQL Editor > New query > colar > Run.

alter table public.products add column if not exists pack_qty integer;
alter table public.products add column if not exists tiny_code text;
