-- Visibilidade de preço no catálogo e quantidade em estoque.
-- Rode no SQL Editor do Supabase: Dashboard > SQL Editor > New query > colar > Run.

alter table public.products add column if not exists show_price boolean not null default true;
alter table public.products add column if not exists stock_qty integer;
