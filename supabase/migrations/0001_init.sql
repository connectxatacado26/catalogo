-- Connect X Atacado — schema inicial
-- Rode este arquivo inteiro no SQL Editor do seu projeto Supabase
-- (Dashboard > SQL Editor > New query > colar > Run).

create extension if not exists "pgcrypto";

-- =========================================================
-- Tabelas
-- =========================================================

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null,
  brand text,
  description text,
  price numeric(10,2) not null default 0,
  image_url text,
  stock text not null default 'em_estoque' check (stock in ('em_estoque','sob_consulta')),
  promoted boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_brand_idx on public.products (brand);
create index if not exists products_hidden_idx on public.products (hidden);

-- Linha única de configurações da loja (nome, whatsapp de recebimento)
create table if not exists public.store_config (
  id boolean primary key default true check (id),
  store_name text not null default 'Connect X Atacado',
  whatsapp_number text
);
insert into public.store_config (id, store_name)
values (true, 'Connect X Atacado')
on conflict (id) do nothing;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_phone text,
  notes text,
  items jsonb not null,
  total numeric(10,2) not null default 0,
  status text not null default 'aguardando' check (status in ('aguardando','confirmado','enviado','cancelado')),
  created_at timestamptz not null default now()
);

create index if not exists orders_created_idx on public.orders (created_at desc);

-- =========================================================
-- Trigger: atualiza updated_at dos produtos automaticamente
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

-- =========================================================
-- RLS (Row Level Security)
-- =========================================================

alter table public.products enable row level security;
alter table public.store_config enable row level security;
alter table public.orders enable row level security;

-- Produtos: qualquer visitante vê os que não estão ocultos;
-- a equipe (logada) vê e edita tudo.
drop policy if exists "products_public_read" on public.products;
create policy "products_public_read" on public.products
  for select
  using (hidden = false or auth.role() = 'authenticated');

drop policy if exists "products_staff_write" on public.products;
create policy "products_staff_write" on public.products
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Configurações da loja: leitura pública (o carrinho precisa do WhatsApp
-- configurado), escrita só pela equipe logada.
drop policy if exists "config_public_read" on public.store_config;
create policy "config_public_read" on public.store_config
  for select
  using (true);

drop policy if exists "config_staff_write" on public.store_config;
create policy "config_staff_write" on public.store_config
  for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Pedidos: qualquer visitante pode CRIAR um pedido (checkout do carrinho),
-- mas só a equipe logada pode listar/ler todos os pedidos.
-- A leitura de UM pedido específico (para a página "Ver pedido" do
-- cliente) passa pela função get_order() abaixo, que não expõe a lista.
drop policy if exists "orders_public_insert" on public.orders;
create policy "orders_public_insert" on public.orders
  for insert
  with check (true);

drop policy if exists "orders_staff_read" on public.orders;
create policy "orders_staff_read" on public.orders
  for select
  using (auth.role() = 'authenticated');

drop policy if exists "orders_staff_update" on public.orders;
create policy "orders_staff_update" on public.orders
  for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- =========================================================
-- Função pública para ler UM pedido pelo id (link enviado no WhatsApp)
-- Não permite listar todos os pedidos — só busca exata por UUID.
-- =========================================================

create or replace function public.get_order(order_id uuid)
returns setof public.orders
language sql
security definer
set search_path = public
as $$
  select * from public.orders where id = order_id;
$$;

grant execute on function public.get_order(uuid) to anon, authenticated;

-- =========================================================
-- Storage: bucket de imagens dos produtos (leitura pública, escrita
-- só para a equipe logada)
-- =========================================================

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

drop policy if exists "product_images_public_read" on storage.objects;
create policy "product_images_public_read" on storage.objects
  for select
  using (bucket_id = 'product-images');

drop policy if exists "product_images_staff_insert" on storage.objects;
create policy "product_images_staff_insert" on storage.objects
  for insert
  with check (bucket_id = 'product-images' and auth.role() = 'authenticated');

drop policy if exists "product_images_staff_update" on storage.objects;
create policy "product_images_staff_update" on storage.objects
  for update
  using (bucket_id = 'product-images' and auth.role() = 'authenticated');

drop policy if exists "product_images_staff_delete" on storage.objects;
create policy "product_images_staff_delete" on storage.objects
  for delete
  using (bucket_id = 'product-images' and auth.role() = 'authenticated');

-- =========================================================
-- Realtime: mantém o catálogo e o painel admin sincronizados
-- entre abas/dispositivos sem precisar recarregar a página.
-- =========================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products'
  ) then
    alter publication supabase_realtime add table public.products;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'store_config'
  ) then
    alter publication supabase_realtime add table public.store_config;
  end if;
end $$;
