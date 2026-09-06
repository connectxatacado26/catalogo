import { supabase } from './supabaseClient.js';

var state = {
  products: [],
  orders: [],
  config: { store_name: 'Connect X Atacado', whatsapp_number: '' },
  session: null
};
var editingId = null;

/* ============================================================
   Utilidades
   ============================================================ */
function fmtBRL(n) {
  n = Number(n) || 0;
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function toast(msg) {
  var host = document.getElementById('toastHost');
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  host.appendChild(el);
  requestAnimationFrame(function () { el.classList.add('show'); });
  setTimeout(function () { el.classList.remove('show'); setTimeout(function () { el.remove(); }, 300); }, 3200);
}
function friendlyError(err) {
  var msg = (err && (err.message || err.error_description)) || '';
  if (/row-level security|permission|policy/i.test(msg)) return 'Sem permissão. Faça login novamente.';
  if (/JWT|auth/i.test(msg)) return 'Sessão expirada. Faça login novamente.';
  return msg || 'Não foi possível concluir a ação.';
}
function slugify(s) {
  return String(s || 'produto').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'produto';
}
function statusLabel(s) {
  return { aguardando: 'Aguardando', confirmado: 'Confirmado', enviado: 'Enviado', cancelado: 'Cancelado' }[s] || s;
}
function brandsList() {
  var set = {};
  state.products.forEach(function (p) { if (p.brand) set[p.brand] = true; });
  return Object.keys(set).sort();
}
function categoriesAdminList() {
  var set = {};
  state.products.forEach(function (p) { if (p.category) set[p.category] = true; });
  return Object.keys(set).sort();
}

/* ============================================================
   Upload de imagem
   ============================================================ */
function fileToResizedBlob(file, maxSize) {
  maxSize = maxSize || 900;
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error('read_failed')); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { reject(new Error('decode_failed')); };
      img.onload = function () {
        var scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        var cw = Math.max(1, Math.round(img.width * scale));
        var ch = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob); else reject(new Error('encode_failed'));
        }, 'image/jpeg', 0.78);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
async function uploadProductImage(file, productName) {
  var blob = await fileToResizedBlob(file);
  var path = Date.now() + '-' + slugify(productName) + '.jpg';
  var up = await supabase.storage.from('product-images').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (up.error) throw up.error;
  return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
}

/* ============================================================
   Autenticação
   ============================================================ */
async function doLogin() {
  var email = document.getElementById('login_email').value.trim();
  var password = document.getElementById('login_password').value;
  var errBox = document.getElementById('loginError');
  var btn = document.getElementById('loginBtn');
  errBox.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  var res = await supabase.auth.signInWithPassword({ email: email, password: password });
  btn.disabled = false;
  btn.textContent = 'Entrar';
  if (res.error) {
    errBox.textContent = 'E-mail ou senha inválidos.';
    errBox.style.display = 'block';
    return;
  }
  state.session = res.data.session;
  await loadAll();
  showDashboard();
  subscribeRealtime();
}
async function doLogout() {
  await supabase.auth.signOut();
  state.session = null;
  showLogin();
}

/* ============================================================
   Alternância de telas
   ============================================================ */
function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('adminDash').style.display = 'none';
}
function showDashboard() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminDash').style.display = 'block';
  document.getElementById('adminUserEmail').textContent = state.session ? state.session.user.email : '';
  renderStats();
  renderConfig();
  renderProductList();
  renderOrders();
}

/* ============================================================
   Estatísticas
   ============================================================ */
function renderStats() {
  var total = state.products.length;
  var visible = state.products.filter(function (p) { return !p.hidden; }).length;
  var pending = state.orders.filter(function (o) { return o.status === 'aguardando'; }).length;
  document.getElementById('statsRow').innerHTML =
    '<div class="stat-card"><div class="stat-val">' + total + '</div><div class="stat-label">Produtos</div></div>' +
    '<div class="stat-card"><div class="stat-val">' + visible + '</div><div class="stat-label">Visíveis</div></div>' +
    '<div class="stat-card"><div class="stat-val">' + pending + '</div><div class="stat-label">Pedidos aguardando</div></div>';
}

/* ============================================================
   Configurações da loja
   ============================================================ */
function renderConfig() {
  document.getElementById('cfg_name').value = state.config.store_name || '';
  document.getElementById('cfg_wpp').value = state.config.whatsapp_number || '';
}
async function saveConfig() {
  var name = document.getElementById('cfg_name').value.trim();
  var wpp = document.getElementById('cfg_wpp').value.replace(/\D/g, '');
  var res = await supabase.from('store_config').update({ store_name: name, whatsapp_number: wpp }).eq('id', true);
  if (res.error) { toast(friendlyError(res.error)); return; }
  state.config.store_name = name;
  state.config.whatsapp_number = wpp;
  toast('Configurações salvas.');
}

/* ============================================================
   Lista de produtos
   ============================================================ */
function renderProductList() {
  var host = document.getElementById('productAdminList');
  if (!state.products.length) {
    host.innerHTML = '<div class="admin-section-body" style="color:var(--ink-soft);font-size:14px;">Nenhum produto. Clique em "+ Novo produto" para começar.</div>';
    return;
  }
  var rows = state.products.map(function (p) {
    var thumb = p.image_url
      ? '<img src="' + escapeHtml(p.image_url) + '" alt="">'
      : '<span>📷</span>';
    var flags = [];
    if (p.promoted) flags.push('<span class="badge badge-promo" style="font-size:10px;padding:2px 6px;">★ destaque</span>');
    if (p.stock_qty === 0) flags.push('<span class="badge badge-alert" style="font-size:10px;padding:2px 6px;">sem estoque</span>');
    if (p.show_price === false) flags.push('<span class="badge" style="font-size:10px;padding:2px 6px;background:var(--paper-2);color:var(--ink-soft);">preço oculto</span>');
    if (p.stock === 'sob_consulta') flags.push('<span class="badge" style="font-size:10px;padding:2px 6px;background:var(--paper-2);color:var(--ink-soft);">sob consulta</span>');
    return (
      '<div class="product-admin-row' + (p.hidden ? ' hidden-product' : '') + '">' +
        '<div class="product-admin-thumb">' + thumb + '</div>' +
        '<div class="product-admin-info">' +
          '<div class="pname">' + escapeHtml(p.name) +
            (p.brand ? ' <span style="font-weight:400;color:var(--ink-soft);">· ' + escapeHtml(p.brand) + '</span>' : '') +
          '</div>' +
          '<div class="pmeta">' +
            (p.category ? '<span style="background:var(--paper-2);padding:2px 7px;border-radius:5px;font-size:11px;">' + escapeHtml(p.category) + '</span>' : '') +
            (p.code ? '<span>cód. ' + escapeHtml(p.code) + '</span>' : '') +
            (p.stock_qty !== null && p.stock_qty !== undefined ? '<span>' + p.stock_qty + ' em estoque</span>' : '') +
            flags.join('') +
          '</div>' +
        '</div>' +
        '<div class="product-admin-price">' + fmtBRL(p.price) + '</div>' +
        '<div class="product-admin-actions">' +
          '<button type="button" data-act="edit" data-id="' + p.id + '" title="Editar">✎</button>' +
          '<button type="button" data-act="promote" data-id="' + p.id + '" title="' + (p.promoted ? 'Remover destaque' : 'Destacar') + '">★</button>' +
          '<button type="button" data-act="hide" data-id="' + p.id + '" class="toggle-status-btn ' + (p.hidden ? 'btn-activate' : 'btn-deactivate') + '">' + (p.hidden ? 'Ativar' : 'Desativar') + '</button>' +
          '<button type="button" data-act="delete" data-id="' + p.id + '" title="Excluir" class="danger">🗑</button>' +
        '</div>' +
      '</div>'
    );
  }).join('');
  host.innerHTML = '<div class="product-admin-list">' + rows + '</div>';
  Array.prototype.forEach.call(host.querySelectorAll('[data-act]'), function (btn) {
    btn.addEventListener('click', function () {
      var act = btn.getAttribute('data-act');
      var id = btn.getAttribute('data-id');
      if (act === 'edit') openProductModal(id);
      else if (act === 'promote') toggleProductField(id, 'promoted');
      else if (act === 'hide') toggleProductField(id, 'hidden');
      else if (act === 'delete') deleteProduct(id);
    });
  });
}

/* ============================================================
   Pedidos
   ============================================================ */
function renderOrders() {
  var host = document.getElementById('ordersAdminList');
  var countEl = document.getElementById('ordersCount');
  countEl.textContent = state.orders.length;
  if (!state.orders.length) {
    host.innerHTML = '<div class="admin-section-body" style="color:var(--ink-soft);font-size:14px;">Nenhum pedido registrado ainda.</div>';
    return;
  }
  var statuses = ['aguardando', 'confirmado', 'enviado', 'cancelado'];
  var rows = state.orders.map(function (o) {
    var itemsSummary = (o.items || []).map(function (it) { return it.qty + 'x ' + it.name; }).join(', ');
    var options = statuses.map(function (s) {
      return '<option value="' + s + '"' + (o.status === s ? ' selected' : '') + '>' + statusLabel(s) + '</option>';
    }).join('');
    return (
      '<div class="order-row">' +
        '<div>' +
          '<div class="oname">' + escapeHtml(o.customer_name) + (o.customer_phone ? ' · ' + escapeHtml(o.customer_phone) : '') + '</div>' +
          '<div class="ometa">' + escapeHtml(itemsSummary) + ' · ' + new Date(o.created_at).toLocaleString('pt-BR') + '</div>' +
        '</div>' +
        '<div class="order-price">' + fmtBRL(o.total) + '</div>' +
        '<select class="status-select" data-order-status="' + o.id + '">' + options + '</select>' +
      '</div>'
    );
  }).join('');
  host.innerHTML = rows;
  Array.prototype.forEach.call(host.querySelectorAll('[data-order-status]'), function (sel) {
    sel.addEventListener('change', async function () {
      var id = sel.getAttribute('data-order-status');
      var res = await supabase.from('orders').update({ status: sel.value }).eq('id', id);
      if (res.error) { toast(friendlyError(res.error)); return; }
      toast('Status atualizado.');
      await loadOrders();
    });
  });
}

/* ============================================================
   Modal de produto
   ============================================================ */
function openProductModal(id) {
  editingId = id || null;
  var p = id ? state.products.filter(function (pp) { return pp.id === id; })[0] : null;
  document.getElementById('productModalTitle').textContent = p ? 'Editar produto' : 'Novo produto';
  var body = document.getElementById('productModalBody');
  body.innerHTML =
    '<div class="modal-tabs">' +
      '<button type="button" class="modal-tab-btn active" data-tab="general">Dados gerais</button>' +
      '<button type="button" class="modal-tab-btn" data-tab="prices">Preços &amp; Estoque</button>' +
    '</div>' +
    '<div class="modal-tab-panel active" data-panel="general">' +
      '<div class="field-row">' +
        '<div class="field"><label>Código (SKU)</label><input type="text" id="f_code" value="' + escapeHtml(p ? p.code : '') + '"></div>' +
        '<div class="field"><label>Marca</label><input type="text" id="f_brand" list="brandList" value="' + escapeHtml(p ? p.brand : '') + '" placeholder="ex: Gold"></div>' +
      '</div>' +
      '<datalist id="brandList">' + brandsList().map(function (b) { return '<option value="' + escapeHtml(b) + '">'; }).join('') + '</datalist>' +
      '<div class="field"><label>Categoria</label><input type="text" id="f_category" list="categoryList" value="' + escapeHtml(p ? (p.category || '') : '') + '" placeholder="ex: Bolsas, Bijuterias, Acessórios"></div>' +
      '<datalist id="categoryList">' + categoriesAdminList().map(function (c) { return '<option value="' + escapeHtml(c) + '">'; }).join('') + '</datalist>' +
      '<div class="field"><label>Nome do produto</label><input type="text" id="f_name" value="' + escapeHtml(p ? p.name : '') + '"></div>' +
      '<div class="field"><label>Descrição curta</label><textarea id="f_desc">' + escapeHtml(p ? p.description : '') + '</textarea></div>' +
      '<div class="field"><label>Unidade de medida</label><select id="f_unit">' +
        '<option value="Un"' + (!(p && p.unit === 'Pack') ? ' selected' : '') + '>Un — Unidade</option>' +
        '<option value="Pack"' + (p && p.unit === 'Pack' ? ' selected' : '') + '>Pack</option>' +
      '</select></div>' +
      '<div class="field" id="packQtyField"' + (p && p.unit === 'Pack' ? '' : ' style="display:none"') + '>' +
        '<label>Unidades por pack</label>' +
        '<input type="number" min="1" step="1" id="f_pack_qty" value="' + (p && p.pack_qty ? p.pack_qty : 2) + '" placeholder="Ex: 6">' +
      '</div>' +
      '<div class="field"><label>Imagem do produto</label>' +
        '<div class="imgpicker-large">' +
          '<div class="preview" id="imgPreview">' + (p && p.image_url ? '<img src="' + escapeHtml(p.image_url) + '">' : '📷 Escolher imagem') + '</div>' +
          '<input type="file" accept="image/*" id="f_image">' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="modal-tab-panel" data-panel="prices">' +
      '<div class="tiny-sync-banner">🔄 Preços e estoque serão sincronizados via API com o <strong>Tiny ERP</strong>.</div>' +
      '<div class="field-row">' +
        '<div class="field"><label>Preço (R$)</label><input type="number" min="0" step="0.01" id="f_price" value="' + (p ? p.price : '') + '"></div>' +
        '<div class="field"><label>Preço promocional (R$)</label><input type="number" min="0" step="0.01" id="f_sale_price" placeholder="0 = sem promoção" value="' + (p && p.sale_price ? p.sale_price : '') + '"></div>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label>Qtd. mínima do pedido</label><input type="number" min="1" step="1" id="f_min_qty" value="' + (p ? (p.min_qty || 1) : 1) + '"></div>' +
        '<div class="field"><label>Disponibilidade</label><select id="f_stock">' +
          '<option value="em_estoque"' + (p && p.stock === 'em_estoque' ? ' selected' : (!p ? ' selected' : '')) + '>Em estoque</option>' +
          '<option value="sob_consulta"' + (p && p.stock === 'sob_consulta' ? ' selected' : '') + '>Sob consulta</option>' +
        '</select></div>' +
      '</div>' +
      '<div class="field"><label>Código Tiny (ERP)</label><input type="text" id="f_tiny_code" value="' + escapeHtml(p ? p.tiny_code || '' : '') + '" placeholder="Preenchido automaticamente via API"></div>' +
      '<div class="field-row">' +
        '<div class="field"><label>Estoque (qtd.)</label><input type="number" min="0" step="1" id="f_stock_qty" value="' + (p && p.stock_qty !== null && p.stock_qty !== undefined ? p.stock_qty : '') + '" placeholder="Vazio = ilimitado"></div>' +
        '<div class="field" style="justify-content:flex-end;gap:6px;">' +
          '<label>Exibir preço no catálogo</label>' +
          '<label class="checkbox-row"><input type="checkbox" id="f_show_price"' + (p && p.show_price === false ? '' : ' checked') + '> Mostrar preço para o cliente</label>' +
        '</div>' +
      '</div>' +
      '<label class="checkbox-row"><input type="checkbox" id="f_promoted"' + (p && p.promoted ? ' checked' : '') + '> Destacar na vitrine (★)</label>' +
    '</div>';

  var fileInput = document.getElementById('f_image');
  var pendingFile = null;
  var pendingImageUrl = p ? p.image_url : '';
  fileInput.addEventListener('change', function () {
    var file = fileInput.files[0];
    if (!file) return;
    pendingFile = file;
    var reader = new FileReader();
    reader.onload = function () { document.getElementById('imgPreview').innerHTML = '<img src="' + reader.result + '">'; };
    reader.readAsDataURL(file);
  });
  body._getPendingFile = function () { return pendingFile; };
  body._getImageUrl = function () { return pendingImageUrl; };
  document.getElementById('f_unit').addEventListener('change', function () {
    document.getElementById('packQtyField').style.display = this.value === 'Pack' ? '' : 'none';
  });
  Array.prototype.forEach.call(body.querySelectorAll('[data-tab]'), function (btn) {
    btn.addEventListener('click', function () {
      Array.prototype.forEach.call(body.querySelectorAll('[data-tab]'), function (b) { b.classList.remove('active'); });
      Array.prototype.forEach.call(body.querySelectorAll('[data-panel]'), function (panel) { panel.classList.remove('active'); });
      btn.classList.add('active');
      body.querySelector('[data-panel="' + btn.getAttribute('data-tab') + '"]').classList.add('active');
    });
  });
  document.getElementById('productModalOverlay').classList.add('open');
}
function closeProductModal() {
  document.getElementById('productModalOverlay').classList.remove('open');
  editingId = null;
}
async function saveProductFromModal() {
  var body = document.getElementById('productModalBody');
  var name = document.getElementById('f_name').value.trim();
  if (!name) { toast('Informe o nome do produto.'); return; }
  var saveBtn = document.getElementById('saveProductBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Salvando…';
  try {
    var imageUrl = body._getImageUrl ? body._getImageUrl() : '';
    var pendingFile = body._getPendingFile ? body._getPendingFile() : null;
    if (pendingFile) imageUrl = await uploadProductImage(pendingFile, name);
    var unitVal = document.getElementById('f_unit').value;
    var stockQtyRaw = document.getElementById('f_stock_qty').value;
    var stockQty = stockQtyRaw === '' ? null : (parseInt(stockQtyRaw, 10) || 0);
    var data = {
      code: document.getElementById('f_code').value.trim(),
      brand: document.getElementById('f_brand').value.trim(),
      category: document.getElementById('f_category').value.trim() || null,
      name: name,
      description: document.getElementById('f_desc').value.trim(),
      unit: unitVal,
      pack_qty: unitVal === 'Pack' ? (parseInt(document.getElementById('f_pack_qty').value, 10) || 2) : null,
      price: parseFloat(document.getElementById('f_price').value) || 0,
      sale_price: parseFloat(document.getElementById('f_sale_price').value) || null,
      min_qty: parseInt(document.getElementById('f_min_qty').value, 10) || 1,
      stock: document.getElementById('f_stock').value,
      stock_qty: stockQty,
      show_price: document.getElementById('f_show_price').checked,
      tiny_code: document.getElementById('f_tiny_code').value.trim() || null,
      promoted: document.getElementById('f_promoted').checked,
      image_url: imageUrl
    };
    if (stockQty === 0) data.hidden = true;
    var res;
    if (editingId) {
      res = await supabase.from('products').update(data).eq('id', editingId);
    } else {
      if (data.hidden === undefined) data.hidden = false;
      res = await supabase.from('products').insert([data]);
    }
    if (res.error) throw res.error;
    toast(editingId ? 'Produto atualizado.' : 'Produto adicionado ao catálogo.');
    closeProductModal();
    await loadProducts();
  } catch (err) {
    toast(friendlyError(err));
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Salvar produto';
  }
}
async function toggleProductField(id, field) {
  var p = state.products.filter(function (pp) { return pp.id === id; })[0];
  if (!p) return;
  var patch = {}; patch[field] = !p[field];
  if (field === 'hidden' && patch.hidden === false && p.stock_qty === 0) {
    var ok = window.confirm('O produto está indisponível em seu estoque. Deseja exibi-lo mesmo assim?');
    if (!ok) return;
  }
  var res = await supabase.from('products').update(patch).eq('id', id);
  if (res.error) { toast(friendlyError(res.error)); return; }
  toast(field === 'hidden'
    ? (patch.hidden ? 'Produto desativado do catálogo.' : 'Produto ativado no catálogo.')
    : (patch.promoted ? 'Produto destacado.' : 'Destaque removido.'));
  await loadProducts();
}
async function deleteProduct(id) {
  if (!window.confirm('Excluir este produto definitivamente?')) return;
  var res = await supabase.from('products').delete().eq('id', id);
  if (res.error) { toast(friendlyError(res.error)); return; }
  toast('Produto excluído.');
  await loadProducts();
}

/* ============================================================
   Carregamento de dados
   ============================================================ */
async function loadProducts() {
  var res = await supabase.from('products').select('*').order('created_at', { ascending: false });
  if (res.error) { console.error(res.error); return; }
  state.products = res.data || [];
  if (state.session) { renderStats(); renderProductList(); }
}
async function loadConfig() {
  var res = await supabase.from('store_config').select('*').eq('id', true).single();
  if (!res.error && res.data) state.config = res.data;
  if (state.session) renderConfig();
}
async function loadOrders() {
  var res = await supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(50);
  if (!res.error) state.orders = res.data || [];
  if (state.session) { renderStats(); renderOrders(); }
}
async function loadAll() {
  await Promise.all([loadProducts(), loadConfig(), loadOrders()]);
}

/* ============================================================
   Realtime
   ============================================================ */
function subscribeRealtime() {
  supabase.channel('admin-products').on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, function () { loadProducts(); }).subscribe();
  supabase.channel('admin-orders').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, function () { loadOrders(); }).subscribe();
  supabase.channel('admin-config').on('postgres_changes', { event: '*', schema: 'public', table: 'store_config' }, function () { loadConfig(); }).subscribe();
}

/* ============================================================
   Tiny ERP — sincronização manual
   ============================================================ */
async function syncWithTiny() {
  var btn = document.getElementById('tinySyncBtn');
  var statusEl = document.getElementById('tinySyncStatus');
  btn.disabled = true;
  btn.textContent = '⏳ Sincronizando…';
  statusEl.textContent = 'Buscando produtos no Tiny ERP (marca GOLD)…';
  statusEl.style.color = 'var(--ink-soft)';
  try {
    var cfg = window.CONNECTX_CONFIG || {};
    var url = (cfg.SUPABASE_URL || '') + '/functions/v1/sync-tiny';
    var session = (await supabase.auth.getSession()).data.session;
    var token = session ? session.access_token : '';
    var res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    var data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || ('HTTP ' + res.status));
    }
    var ts = data.synced_at ? new Date(data.synced_at).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR');
    statusEl.innerHTML =
      '✅ Última sincronização: ' + ts +
      ' · <strong>' + data.total_tiny + '</strong> produto(s) GOLD encontrado(s)' +
      ' · <strong>' + data.created + '</strong> novo(s) · <strong>' + data.updated + '</strong> atualizado(s)' +
      (data.errors ? ' · <span style="color:#c0392b;">' + data.errors + ' erro(s)</span>' : '');
    statusEl.style.color = 'var(--ink)';
    toast('Sincronização concluída: ' + data.created + ' novo(s), ' + data.updated + ' atualizado(s).');
    await loadProducts();
  } catch (err) {
    statusEl.textContent = '❌ Erro: ' + (err.message || 'Não foi possível conectar com a Edge Function.');
    statusEl.style.color = '#c0392b';
    toast('Erro na sincronização: ' + (err.message || 'verifique o console.'));
    console.error('[syncWithTiny]', err);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Sincronizar agora';
  }
}

/* ============================================================
   Início
   ============================================================ */
async function init() {
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('login_password').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  document.getElementById('logoutBtn').addEventListener('click', doLogout);
  document.getElementById('newProductBtn').addEventListener('click', function () { openProductModal(null); });
  document.getElementById('saveConfigBtn').addEventListener('click', saveConfig);
  document.getElementById('tinySyncBtn').addEventListener('click', syncWithTiny);
  document.getElementById('closeProductModalBtn').addEventListener('click', closeProductModal);
  document.getElementById('cancelProductBtn').addEventListener('click', closeProductModal);
  document.getElementById('saveProductBtn').addEventListener('click', saveProductFromModal);

  var sessionRes = await supabase.auth.getSession();
  state.session = sessionRes.data.session || null;
  supabase.auth.onAuthStateChange(function (_event, session) {
    state.session = session;
    if (!session) showLogin();
  });

  if (state.session) {
    await loadAll();
    showDashboard();
    subscribeRealtime();
  } else {
    showLogin();
  }
}

init();
