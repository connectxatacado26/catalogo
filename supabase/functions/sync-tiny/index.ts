import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TINY_TOKEN        = Deno.env.get('TINY_TOKEN') ?? ''
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SVC_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRON_SECRET       = Deno.env.get('CRON_SECRET') ?? ''

const TINY_BASE    = 'https://api.tiny.com.br/api2'
const TARGET_BRAND = 'gold'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

function wait(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function tinyGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${TINY_BASE}/${endpoint}`)
  url.searchParams.set('token', TINY_TOKEN)
  url.searchParams.set('formato', 'JSON')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Tiny HTTP ${res.status} em ${endpoint}`)
  const json = await res.json()
  return json.retorno
}

async function fetchAllGoldProducts(): Promise<any[]> {
  // Produtos GOLD têm "gold" no nome (ex: A'GOLD, a'Gold, A'Gold)
  // O parâmetro "pesquisa" busca por texto no nome do produto
  const collected: any[] = []
  let page = 1
  while (true) {
    const ret = await tinyGet('produtos.pesquisa.php', {
      pagina:   String(page),
      situacao: 'A',
      pesquisa: 'gold',
    })
    if (ret?.status !== 'OK') break
    const items: any[] = ret.produtos ?? []
    for (const item of items) {
      const p = item.produto ?? item
      // Garante que "gold" está realmente no nome (case-insensitive)
      if (typeof p.nome === 'string' && p.nome.toLowerCase().includes('gold')) {
        collected.push(p)
      }
    }
    const totalPages = parseInt(ret.numero_paginas ?? '1', 10)
    if (page >= totalPages) break
    page++
    await wait(350)
  }
  return collected
}

async function fetchStock(tinyId: string): Promise<number | null> {
  try {
    const ret = await tinyGet('produto.obter.estoque.php', { id: tinyId })
    if (ret?.status !== 'OK') return null
    const saldo = parseFloat(ret.produto?.saldo ?? '')
    return isNaN(saldo) ? null : Math.max(0, Math.floor(saldo))
  } catch { return null }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  // Autorização: cron secret OU JWT de admin válido
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(SUPABASE_URL, SUPABASE_SVC_KEY)
  let authorized = false

  if (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`) {
    authorized = true
  } else if (authHeader.startsWith('Bearer ')) {
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (user) authorized = true
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: 'Não autorizado.' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  if (!TINY_TOKEN) {
    return new Response(JSON.stringify({ error: 'TINY_TOKEN não configurado.' }), {
      status: 503, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  let body: any = {}
  try { body = await req.json() } catch { /* sem body */ }

  // Modo debug: detalhe de um produto específico pelo ID
  if (body.debug === true && body.produto_id) {
    const ret = await tinyGet('produto.obter.php', { id: String(body.produto_id) })
    return new Response(JSON.stringify({ detalhe_produto: ret }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // Modo debug: busca com pesquisa=gold para ver quantos produtos retornam
  if (body.debug === true) {
    const ret = await tinyGet('produtos.pesquisa.php', { pagina: '1', situacao: 'A', pesquisa: 'gold' })
    const items = (ret?.produtos ?? []).map((item: any) => item.produto ?? item)
    const goldItems = items.filter((p: any) => typeof p.nome === 'string' && p.nome.toLowerCase().includes('gold'))
    return new Response(JSON.stringify({
      status:              ret?.status,
      numero_paginas_gold: ret?.numero_paginas,
      total_pagina_1:      items.length,
      gold_na_pagina_1:    goldItems.length,
      exemplos_gold:       goldItems.slice(0, 5).map((p: any) => ({ id: p.id, nome: p.nome, preco: p.preco })),
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // Sincronização normal
  try {
    const tinyProducts = await fetchAllGoldProducts()
    let created = 0, updated = 0, errors = 0

    // Busca estoque em lotes paralelos de 5 para não estourar o timeout
    async function fetchStockBatch(products: any[]): Promise<Map<string, number | null>> {
      const map = new Map<string, number | null>()
      const BATCH = 5
      for (let i = 0; i < products.length; i += BATCH) {
        const chunk = products.slice(i, i + BATCH)
        const results = await Promise.all(chunk.map(p => fetchStock(String(p.id))))
        chunk.forEach((p, idx) => map.set(String(p.id), results[idx]))
        if (i + BATCH < products.length) await wait(200)
      }
      return map
    }

    const stockMap = await fetchStockBatch(tinyProducts)

    // Busca quais tiny_codes já existem no banco de uma vez só
    const tinyCodes = tinyProducts.map(p => String(p.id))
    const { data: existingRows } = await supabase
      .from('products')
      .select('id, tiny_code')
      .in('tiny_code', tinyCodes)
    const existingMap = new Map((existingRows ?? []).map((r: any) => [r.tiny_code, r.id]))

    // Upsert em lotes de 20
    const UPSERT_BATCH = 20
    for (let i = 0; i < tinyProducts.length; i += UPSERT_BATCH) {
      const chunk = tinyProducts.slice(i, i + UPSERT_BATCH)
      await Promise.all(chunk.map(async tp => {
        try {
          const tinyCode = String(tp.id)
          const stockQty = stockMap.get(tinyCode) ?? null
          const price     = parseFloat(tp.preco ?? '0') || 0
          const zeroStock = stockQty === 0
          const existId   = existingMap.get(tinyCode)

          if (existId) {
            const patch: Record<string, any> = {
              name:       tp.nome?.trim(),
              brand:      "A'Gold",
              price,
              stock_qty:  stockQty,
              updated_at: new Date().toISOString(),
            }
            if (tp.codigo) patch.code = tp.codigo
            if (zeroStock) patch.hidden = true
            await supabase.from('products').update(patch).eq('id', existId)
            updated++
          } else {
            await supabase.from('products').insert({
              code:        tp.codigo ?? '',
              name:        tp.nome?.trim() ?? '',
              brand:       "A'Gold",
              price,
              stock_qty:   stockQty,
              tiny_code:   tinyCode,
              hidden:      zeroStock,
              stock:       'em_estoque',
              description: '',
              unit:        tp.unidade === 'PC' ? 'Pack' : 'Un',
              show_price:  true,
              promoted:    false,
              min_qty:     1,
            })
            created++
          }
        } catch (e) {
          console.error('Erro produto', tp.id, e)
          errors++
        }
      }))
    }

    return new Response(JSON.stringify({
      ok:         true,
      total_tiny: tinyProducts.length,
      created,
      updated,
      errors,
      synced_at:  new Date().toISOString(),
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message ?? 'Erro inesperado.' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
