-- Tabela de banners para o carrossel do catálogo
CREATE TABLE IF NOT EXISTS public.banners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL DEFAULT '',
  subtitle    text,
  image_url   text,
  link        text,
  btn_text    text,
  sort_order  int NOT NULL DEFAULT 0,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;

-- Visitantes anônimos leem apenas banners ativos
CREATE POLICY "banners_anon_select" ON public.banners
  FOR SELECT TO anon USING (enabled = true);

-- Usuários autenticados (admin) têm acesso total
CREATE POLICY "banners_auth_all" ON public.banners
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
