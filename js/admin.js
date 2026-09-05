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
    if (p.hidden) flags.push('<span class="badge badge-alert" style="font-size:10px;padding:2px 6px;">oculto</span>');
    if (p.stock === 'sob_consulta') flags.push('<span class="badge" style="font-size:10px;padding:2px 6px;background:var(--paper-2);color:var(--ink-soft);">sob consulta</span>');
    return (
      '<div class="product-admin-row' + (p.hidden ? ' hidden-product' : '') + '">' +
        '<div class="product-admin-thumb">' + thumb + '</div>' +
        '<div class="product-admin-info">' +
          '<div class="pname">' + escapeHtml(p.name) +
            (p.brand ? ' <span style="font-weight:400;color:var(--ink-soft);">· ' + escapeHtml(p.brand) + '</span>' : '') +
          '</div>' +
          '<div class="pmeta">' + (p.code ? '<span>cód. ' + escapeHtml(p.code) + '</span>' : '') + flags.join('') + '</div>' +
        '</div>' +
        '<div class="product-admin-price">' + fmtBRL(p.price) + '</div>' +
        '<div class="product-admin-actions">' +
          '<button type="button" data-act="edit" data-id="' + p.id + '" title="Editar">✎</button>' +
          '<button type="button" data-act="promote" data-id="' + p.id + '" title="' + (p.promoted ? 'Remover destaque' : 'Destacar') + '">★</button>' +
          '<button type="button" data-act="hide" data-id="' + p.id + '" title="' + (p.hidden ? 'Mostrar' : 'Ocultar') + '">' + (p.hidden ? '👁' : '⊘') + '</button>' +
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
    '<div class="field-row">' +
      '<div class="field"><label>Código</label><input type="text" id="f_code" value="' + escapeHtml(p ? p.code : '') + '"></div>' +
      '<div class="field"><label>Marca</label><input type="text" id="f_brand" list="brandList" value="' + escapeHtml(p ? p.brand : '') + '" placeholder="ex: Gold"></div>' +
    '</div>' +
    '<datalist id="brandList">' + brandsList().map(function (b) { return '<option value="' + escapeHtml(b) + '">'; }).join('') + '</datalist>' +
    '<div class="field"><label>Nome do produto</label><input type="text" id="f_name" value="' + escapeHtml(p ? p.name : '') + '"></div>' +
    '<div class="field"><label>Descrição curta</label><textarea id="f_desc">' + escapeHtml(p ? p.description : '') + '</textarea></div>' +
    '<div class="field-row">' +
      '<div class="field"><label>Preço (R$)</label><input type="number" min="0" step="0.01" id="f_price" value="' + (p ? p.price : '') + '"></div>' +
      '<div class="field"><label>Disponibilidade</label><select id="f_stock">' +
        '<option value="em_estoque"' + (p && p.stock === 'em_estoque' ? ' selected' : '') + '>Em estoque</option>' +
        '<option value="sob_consulta"' + (p && p.stock === 'sob_consulta' ? ' selected' : '') + '>Sob consulta</option>' +
      '</select></div>' +
    '</div>' +
    '<div class="field"><label>Imagem do produto</label>' +
      '<div class="imgpicker">' +
        '<div class="preview" id="imgPreview">' + (p && p.image_url ? '<img src="' + escapeHtml(p.image_url) + '">' : 'sem imagem') + '</div>' +
        '<input type="file" accept="image/*" id="f_image">' +
      '</div>' +
    '</div>' +
    '<label class="checkbox-row"><input type="checkbox" id="f_promoted"' + (p && p.promoted ? ' checked' : '') + '> Destacar na vitrine (★)</label>';

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
    var data = {
      code: document.getElementById('f_code').value.trim(),
      brand: document.getElementById('f_brand').value.trim(),
      name: name,
      description: document.getElementById('f_desc').value.trim(),
      price: parseFloat(document.getElementById('f_price').value) || 0,
      stock: document.getElementById('f_stock').value,
      promoted: document.getElementById('f_promoted').checked,
      image_url: imageUrl
    };
    var res;
    if (editingId) {
      res = await supabase.from('products').update(data).eq('id', editingId);
    } else {
      data.hidden = false;
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
  var res = await supabase.from('products').update(patch).eq('id', id);
  if (res.error) { toast(friendlyError(res.error)); return; }
  toast(field === 'hidden' ? (patch.hidden ? 'Produto ocultado.' : 'Produto visível novamente.') : (patch.promoted ? 'Produto destacado.' : 'Destaque removido.'));
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
   Início
   ============================================================ */
async function init() {
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('login_password').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  document.getElementById('logoutBtn').addEventListener('click', doLogout);
  document.getElementById('newProductBtn').addEventListener('click', function () { openProductModal(null); });
  document.getElementById('saveConfigBtn').addEventListener('click', saveConfig);
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
