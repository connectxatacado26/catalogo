const TINY_TOKEN = Deno.env.get('TINY_TOKEN') ?? ''
const TINY_BASE  = 'https://api.tiny.com.br/api2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    if (!TINY_TOKEN) {
      return new Response(JSON.stringify({ ok: false, error: 'Token Tiny não configurado.' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()

    const contato = {
      nome:        body.nome        || '',
      tipo_pessoa: body.tipo_pessoa || 'J',
      cpf_cnpj:   body.cpf_cnpj   || '',
      ie_rg:      body.ie_rg       || '',
      email:       body.email       || '',
      fone:        body.fone        || '',
      celular:     body.celular     || '',
      cep:         body.cep         || '',
      endereco:    body.endereco    || '',
      numero:      body.numero      || '',
      complemento: body.complemento || '',
      bairro:      body.bairro      || '',
      cidade:      body.cidade      || '',
      uf:          body.uf          || '',
      obs:         body.obs         || '',
    }

    const payload = new URLSearchParams({
      token:   TINY_TOKEN,
      contato: JSON.stringify({ contato }),
      formato: 'JSON',
    })

    const tinyRes  = await fetch(`${TINY_BASE}/contato.incluir.php`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    payload.toString(),
      signal:  AbortSignal.timeout(10000),
    })

    const tinyJson = await tinyRes.json()
    const status   = tinyJson?.retorno?.status

    if (status === 'OK') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const erros = tinyJson?.retorno?.erros?.map((e: any) => e?.erro).join(', ') || 'Erro desconhecido no Tiny.'
    return new Response(JSON.stringify({ ok: false, error: erros }), {
      status: 422, headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
