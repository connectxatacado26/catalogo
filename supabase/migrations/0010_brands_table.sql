CREATE TABLE IF NOT EXISTS public.brands (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brands_anon_select" ON public.brands
  FOR SELECT TO anon USING (true);

CREATE POLICY "brands_auth_all" ON public.brands
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Inserir a marca inicial (A'Gold / Gold)
INSERT INTO public.brands (name, sort_order) VALUES ('A''Gold', 0);
