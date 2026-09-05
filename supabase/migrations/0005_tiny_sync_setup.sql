-- Configuração para sincronização com Tiny ERP
-- Execute no SQL Editor do Supabase: Dashboard > SQL Editor > New query > colar > Run

-- 1. Garante constraint única no código Tiny (evita duplicatas no upsert)
ALTER TABLE public.products
  ADD CONSTRAINT IF NOT EXISTS products_tiny_code_unique UNIQUE (tiny_code);

-- 2. Habilita extensões necessárias (já disponíveis no Supabase)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 3. Configura sincronização automática a cada 1 hora
--    ANTES de rodar este bloco: defina o segredo no banco com o comando abaixo,
--    substituindo 'SEU_CRON_SECRET' pelo valor gerado (qualquer string longa aleatória):
--
--    ALTER DATABASE postgres SET app.cron_secret = 'SEU_CRON_SECRET';
--
--    O mesmo valor deve ser adicionado como Supabase Secret (nome: CRON_SECRET)
--    em: Supabase Dashboard > Edge Functions > Manage secrets

SELECT cron.schedule(
  'sync-tiny-hourly',
  '0 * * * *',
  format(
    $$
    SELECT net.http_post(
      url     := 'https://vopaqiuieimuuozdoecf.supabase.co/functions/v1/sync-tiny',
      headers := '{"Authorization": "Bearer %s", "Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
    $$,
    current_setting('app.cron_secret')
  )::text
);
