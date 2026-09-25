import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Rate limit: máx 10 tentativas por IP a cada 15 minutos
const RATE_LIMIT = 10
const RATE_WINDOW_MS = 15 * 60 * 1000
const attempts = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT) return false
  entry.count++
  return true
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // Identifica o IP do cliente
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'

  if (!checkRateLimit(ip)) {
    return new Response(
      JSON.stringify({ found: false, error: 'Muitas tentativas. Aguarde 15 minutos.' }),
      { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 429 }
    )
  }

  try {
    const { email } = await req.json()
    if (!email || typeof email !== 'string') {
      return new Response(JSON.stringify({ found: false }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const emailNorm = email.trim().toLowerCase()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Verifica na tabela cadastros (status = importado)
    const { data: rows } = await supabase
      .from('cadastros')
      .select('nome, cpf_cnpj')
      .ilike('email', emailNorm)
      .eq('status', 'importado')
      .limit(1)

    if (rows && rows.length > 0) {
      return new Response(
        JSON.stringify({ found: true, nome: rows[0].nome, cpf_cnpj: rows[0].cpf_cnpj }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Fallback: varre contatos do Tiny comparando campo email (API não filtra por email)
    const tinyToken = Deno.env.get('TINY_TOKEN') ?? ''
    if (tinyToken) {
      const MAX_PAGES = 15 // até ~750 contatos por busca
      for (let page = 1; page <= MAX_PAGES; page++) {
        const tinyRes = await fetch(
          `https://api.tiny.com.br/api2/contatos.pesquisa.php?token=${tinyToken}&situacao=A&pagina=${page}&formato=JSON`,
          { signal: AbortSignal.timeout(8000) }
        ).catch(() => null)

        if (!tinyRes) break
        const tinyData = await tinyRes.json().catch(() => null)
        if (tinyData?.retorno?.status !== 'OK') break

        const contatos: any[] = tinyData.retorno.contatos ?? []
        const match = contatos.find(
          (item: any) => (item.contato?.email ?? '').trim().toLowerCase() === emailNorm
        )

        if (match) {
          const c = match.contato
          const nome      = c.razaoSocial || c.nome || emailNorm
          const cpf_cnpj  = c.cnpj || c.cpf || ''
          const tipo      = c.tipo_pessoa || 'J'
          const fone      = c.fone || ''

          // Auto-importa no cadastros para os próximos logins serem instantâneos
          await supabase.from('cadastros').upsert(
            { email: emailNorm, nome, cpf_cnpj, status: 'importado', tipo_pessoa: tipo, fone, celular: fone },
            { onConflict: 'email' }
          )

          return new Response(
            JSON.stringify({ found: true, nome, cpf_cnpj }),
            { headers: { ...CORS, 'Content-Type': 'application/json' } }
          )
        }

        const totalPages = parseInt(tinyData.retorno.numero_paginas ?? '1', 10)
        if (page >= totalPages) break
        // Pequena pausa para não sobrecarregar a API do Tiny
        await new Promise(r => setTimeout(r, 150))
      }
    }

    return new Response(JSON.stringify({ found: false }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ found: false, error: String(err) }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
