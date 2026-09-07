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

// O anon key tem iat configurado com o relógio do cliente (futuro para o servidor).
// Removemos o Authorization header nas requisições anônimas — PostgREST usa a
// role anon por padrão via apikey, sem validar o JWT.
const anonBearer = 'Bearer ' + (cfg.SUPABASE_ANON_KEY || '');
const customFetch = (url, options = {}) => {
  const hdrs = Object.assign({}, options.headers || {});
  if (hdrs['Authorization'] === anonBearer || hdrs['authorization'] === anonBearer) {
    delete hdrs['Authorization'];
    delete hdrs['authorization'];
  }
  return fetch(url, Object.assign({}, options, { headers: hdrs }));
};

export const supabase = createClient(
  cfg.SUPABASE_URL || '',
  cfg.SUPABASE_ANON_KEY || '',
  { global: { fetch: customFetch } }
);
