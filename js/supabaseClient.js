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

// O anon key tem iat no futuro do servidor. Removemos Authorization nas chamadas
// anônimas: PostgREST usa a role anon via apikey sem validar o JWT.
// Usamos `new Headers()` para copiar corretamente mesmo quando o cliente envia
// um objeto Headers (não um plain object).
const anonBearer = 'Bearer ' + (cfg.SUPABASE_ANON_KEY || '');
const customFetch = (url, options = {}) => {
  const hdrs = new Headers(options.headers || {});
  if (hdrs.get('Authorization') === anonBearer) {
    hdrs.delete('Authorization');
  }
  return fetch(url, Object.assign({}, options, { headers: hdrs }));
};

export const supabase = createClient(
  cfg.SUPABASE_URL || '',
  cfg.SUPABASE_ANON_KEY || '',
  { global: { fetch: customFetch } }
);
