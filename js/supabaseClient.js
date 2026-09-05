// Cliente Supabase compartilhado por toda a aplicação.
// Carregado como módulo ES direto do CDN — sem passo de build.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cfg = window.CONNECTX_CONFIG || {};

if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.indexOf('SEU-PROJETO') > -1) {
  console.warn(
    'Connect X Atacado: configure js/config.js com a URL e a anon key do seu projeto Supabase ' +
    '(copie js/config.example.js e preencha).'
  );
}

export const supabase = createClient(
  cfg.SUPABASE_URL || '',
  cfg.SUPABASE_ANON_KEY || ''
);
