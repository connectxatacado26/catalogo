-- Tabela de fichas de cadastro de clientes
-- Rode no SQL Editor do Supabase: Dashboard > SQL Editor > New query > colar > Run

create table if not exists public.cadastros (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  tipo_pessoa text not null default 'J' check (tipo_pessoa in ('J','F')),
  nome        text not null,
  cpf_cnpj    text,
  ie_rg       text,
  email       text,
  fone        text,
  celular     text,
  cep         text,
  endereco    text,
  numero      text,
  complemento text,
  bairro      text,
  cidade      text,
  uf          text,
  obs         text,
  status      text not null default 'pendente' check (status in ('pendente','importado'))
);

-- Qualquer visitante pode inserir (submeter a ficha)
alter table public.cadastros enable row level security;

create policy "anon pode inserir cadastro"
  on public.cadastros for insert
  to anon
  with check (true);

-- Somente usuários autenticados (admin) podem visualizar e gerenciar
create policy "admin pode ver cadastros"
  on public.cadastros for select
  to authenticated
  using (true);

create policy "admin pode atualizar status"
  on public.cadastros for update
  to authenticated
  using (true);

create policy "admin pode excluir cadastro"
  on public.cadastros for delete
  to authenticated
  using (true);
