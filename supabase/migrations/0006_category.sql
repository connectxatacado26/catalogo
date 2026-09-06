-- Adiciona campo de categoria aos produtos.
-- Rode no SQL Editor do Supabase: Dashboard > SQL Editor > New query > colar > Run.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category text;
