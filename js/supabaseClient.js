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

// O anon key tem iat no futuro do servidor. Removemos Authorization quando contém
// o anon key: PostgREST usa a role anon via apikey sem validar o JWT.
const anonKey = cfg.SUPABASE_ANON_KEY || '';
const customFetch = (url, options = {}) => {
  const hdrs = new Headers(options.headers || {});
  const auth = hdrs.get('Authorization') || '';
  if (anonKey && auth.includes(anonKey)) {
    hdrs.delete('Authorization');
  }
  return fetch(url, Object.assign({}, options, { headers: hdrs }));
};

export const supabase = createClient(
  cfg.SUPABASE_URL || '',
  cfg.SUPABASE_ANON_KEY || '',
  { global: { fetch: customFetch } }
);
