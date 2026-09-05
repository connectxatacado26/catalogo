-- Adiciona campos de unidade, preço promocional e quantidade mínima aos produtos.
-- Rode no SQL Editor do Supabase: Dashboard > SQL Editor > New query > colar > Run.

alter table public.products add column if not exists unit text not null default 'Un';
alter table public.products add column if not exists sale_price numeric(10,2);
alter table public.products add column if not exists min_qty integer not null default 1;
