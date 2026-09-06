CREATE TABLE IF NOT EXISTS public.categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "categories_anon_select" ON public.categories
  FOR SELECT TO anon USING (true);

CREATE POLICY "categories_auth_all" ON public.categories
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
