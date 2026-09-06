-- Adiciona colunas de banner ao store_config
ALTER TABLE public.store_config
  ADD COLUMN IF NOT EXISTS banner_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS banner_image_url text,
  ADD COLUMN IF NOT EXISTS banner_title text,
  ADD COLUMN IF NOT EXISTS banner_subtitle text,
  ADD COLUMN IF NOT EXISTS banner_link text,
  ADD COLUMN IF NOT EXISTS banner_btn_text text;
