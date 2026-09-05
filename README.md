# Connect X Atacado — catálogo para lojistas

Sistema completo: catálogo público, carrinho, checkout com pedido enviado
por WhatsApp, e painel administrativo para a equipe Connect X cadastrar e
gerenciar produtos.

- **Frontend**: HTML/CSS/JS puro (sem build, sem framework) — abre em
  qualquer navegador, publica em qualquer hospedagem de site estático.
- **Backend**: [Supabase](https://supabase.com) — banco de dados
  (Postgres), autenticação da equipe, armazenamento das fotos de
  produto e as regras de segurança que decidem quem pode ver e editar
  o quê.

Não existe servidor próprio para manter: o Supabase cobre banco,
login e arquivos; o navegador fala direto com ele, protegido pelas
regras (RLS) definidas em `supabase/migrations/0001_init.sql`.

---

## 1. Criar o projeto no Supabase

1. Crie uma conta em [supabase.com](https://supabase.com) (pode usar o
   e-mail que preferir).
2. Crie um novo projeto — escolha a região **South America (São
   Paulo)** para menor latência no Brasil. Guarde a senha do banco em
   local seguro (raramente será usada diretamente).
3. Aguarde o projeto ficar "ACTIVE_HEALTHY" (leva 1–2 minutos).

## 2. Rodar o schema (tabelas, regras, bucket de imagens)

1. No painel do projeto, abra **SQL Editor > New query**.
2. Copie todo o conteúdo de `supabase/migrations/0001_init.sql` deste
   projeto e cole ali.
3. Clique em **Run**. Isso cria:
   - as tabelas `products`, `store_config` e `orders`;
   - as regras de segurança (RLS) — catálogo público para visitantes,
     edição restrita à equipe logada, pedidos que qualquer um pode
     criar mas só a equipe pode listar;
   - o bucket de armazenamento `product-images` para as fotos.

## 3. Criar o primeiro usuário da equipe (login do admin)

O site não tem tela de "criar conta" pública — de propósito, para que
só a equipe Connect X consiga entrar no painel administrativo.

1. No painel Supabase: **Authentication > Users > Add user**.
2. Preencha e-mail e senha da primeira pessoa da equipe (pode
   adicionar mais pessoas depois, do mesmo jeito).
3. Recomendado: em **Authentication > Settings**, desative "Allow new
   users to sign up" — assim ninguém consegue criar login sozinho pelo
   site, só vocês pelo painel.

## 4. Conectar o frontend ao seu projeto

1. No painel Supabase: **Project Settings > API**.
2. Copie **Project URL** e a chave **anon public**.
3. Abra `js/config.js` neste projeto e cole os dois valores:

   ```js
   window.CONNECTX_CONFIG = {
     SUPABASE_URL: "https://SEU-PROJETO.supabase.co",
     SUPABASE_ANON_KEY: "sua-anon-key-aqui"
   };
   ```

   A "anon public key" é feita para ficar exposta no navegador — quem
   protege os dados são as regras (RLS) do passo 2, não o sigilo dessa
   chave.

## 5. Rodar localmente (opcional, para testar antes de publicar)

Como não há build, basta servir os arquivos estáticos. Duas opções
simples (escolha uma):

```bash
# Opção A: Python (já vem em muitos sistemas)
python3 -m http.server 8080

# Opção B: Node
npx serve .
```

Abra `http://localhost:8080` no navegador.

> Abrir o `index.html` direto como arquivo (`file://`) **não funciona**
> — módulos ES exigem um servidor, mesmo que local.

## 6. Publicar (hospedagem gratuita)

Qualquer hospedagem de site estático serve. Passo a passo com
**Vercel** (gratuito):

1. Crie uma conta em [vercel.com](https://vercel.com) — pode entrar
   direto com uma conta do GitHub.
2. Suba esta pasta para um repositório no GitHub (crie uma conta em
   [github.com](https://github.com) se ainda não tiver).
3. Em [vercel.com/new](https://vercel.com/new), importe o repositório.
   Não é preciso configurar comando de build nem "output directory" —
   é um site estático puro.
4. Clique em **Deploy**. Em ~1 minuto o site está no ar com uma URL
   `algumacoisa.vercel.app` (dá para trocar por um domínio próprio
   depois, em **Settings > Domains**).

Qualquer atualização enviada ao repositório (`git push`) publica uma
nova versão automaticamente.

---

## Como o sistema funciona

- **Catálogo**: qualquer visitante vê os produtos (nome, código,
  marca, preço, descrição, foto, disponibilidade). Busca por nome,
  código ou marca; filtro por marca; seção de destaques.
- **Carrinho**: local ao navegador do visitante (não precisa de
  login). Ao finalizar, pede nome e WhatsApp (opcional) do lojista.
- **Pedido**: é gravado no banco e ganha uma página própria
  (`/#pedido/<id>`) com os itens, total, status e botão para
  imprimir (vira PDF pela própria função de impressão do navegador).
  A mensagem do WhatsApp já sai com a lista de itens e o link dessa
  página.
- **Painel administrativo** ("Área administrativa", exige login):
  cadastrar, editar, ocultar, destacar e excluir produtos (com foto);
  configurar o nome da loja e o WhatsApp que recebe os pedidos;
  acompanhar os pedidos recentes e mudar o status de cada um
  (aguardando / confirmado / enviado / cancelado).

## Estrutura de arquivos

```
Catalogo_Connectx_Atacado/
├── index.html                     página única (catálogo + admin + pedido)
├── css/styles.css                 todo o visual
├── js/
│   ├── config.js                  suas chaves do Supabase (edite este)
│   ├── config.example.js          modelo do arquivo acima
│   ├── supabaseClient.js          conexão com o Supabase
│   └── app.js                     toda a lógica da aplicação
└── supabase/
    └── migrations/0001_init.sql   schema, regras de segurança, bucket
```

## Próximos passos sugeridos (fora do escopo desta primeira versão)

- Login/senha para lojistas verem preços (hoje o catálogo é público,
  por decisão explícita do time nesta fase de MVP).
- Notificação automática (e-mail ou WhatsApp Business API) quando um
  pedido novo chega, em vez de depender do lojista enviar a mensagem.
- Estúdio de personalização e vendas White Label mencionados na ata
  da reunião — ainda não fazem parte deste sistema.
