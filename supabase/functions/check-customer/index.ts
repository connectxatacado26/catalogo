const TINY_TOKEN = Deno.env.get('TINY_TOKEN') ?? ''
const TINY_BASE  = 'https://api.tiny.com.br/api2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { phone } = await req.json()

    // Sem telefone ou sem token → não bloqueia o checkout
    if (!phone || !TINY_TOKEN) {
      return new Response(JSON.stringify({ found: true }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const cleanPhone = String(phone).replace(/\D/g, '')
    const url = `${TINY_BASE}/contatos.pesquisa.php?token=${TINY_TOKEN}&pesquisa=${encodeURIComponent(cleanPhone)}&formato=JSON`

    const res  = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const json = await res.json()

    const contatos = json?.retorno?.contatos
    const found = json?.retorno?.status === 'OK' &&
                  Array.isArray(contatos) &&
                  contatos.length > 0

    return new Response(JSON.stringify({ found }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (_e) {
    // Em caso de erro (timeout, API fora) não bloqueia o pedido
    return new Response(JSON.stringify({ found: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
