import { supabase } from './supabaseClient.js';

var state = {
  products: [],
  orders: [],
  banners: [],
  categories: [],
  brands: [],
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
  return state.brands.map(function (b) { return b.name; });
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
   Alternância de telas e navegação por painéis
   ============================================================ */
function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('adminDash').style.display = 'none';
}
function showDashboard() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminDash').style.display = 'flex';
  document.getElementById('adminUserEmail').textContent = state.session ? state.session.user.email : '';
  renderStats();
  renderConfig();
  renderProductList();
  renderOrders();
  showPanel('overview');
}
function showPanel(name) {
  document.querySelectorAll('.admin-panel').forEach(function (el) { el.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function (el) { el.classList.remove('active'); });
  var panel = document.getElementById('panel-' + name);
  if (panel) panel.classList.add('active');
  var navBtn = document.querySelector('.nav-item[data-panel="' + name + '"]');
  if (navBtn) navBtn.classList.add('active');
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
  renderTopProducts();
}
function renderTopProducts() {
  var host = document.getElementById('topProductsBody');
  if (!host) return;
  var counts = {};
  state.orders.forEach(function (o) {
    (o.items || []).forEach(function (it) {
      var key = it.name || 'Produto';
      counts[key] = (counts[key] || 0) + (it.qty || 1);
    });
  });
  var sorted = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 8);
  if (!sorted.length) {
    host.innerHTML = '<div style="color:var(--ink-soft);font-size:13px;padding:4px 0;">Nenhum pedido registrado ainda. Os produtos mais pedidos aparecerão aqui.</div>';
    return;
  }
  var max = counts[sorted[0]];
  host.innerHTML = sorted.map(function (name, i) {
    var pct = Math.round(counts[name] / max * 100);
    return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">' +
      '<span style="font-size:11px;font-weight:700;color:var(--ink-faint);width:14px;text-align:right;">' + (i + 1) + '</span>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:13px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(name) + '</div>' +
        '<div style="height:5px;background:var(--line);border-radius:3px;margin-top:5px;">' +
          '<div style="height:100%;width:' + pct + '%;background:var(--accent);border-radius:3px;"></div>' +
        '</div>' +
      '</div>' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;color:var(--ink-soft);white-space:nowrap;">' + counts[name] + ' un.</span>' +
    '</div>';
  }).join('');
}

/* ============================================================
   Configurações da loja
   ============================================================ */
function renderConfig() {
  document.getElementById('cfg_name').value = state.config.store_name || '';
  document.getElementById('cfg_wpp').value = state.config.whatsapp_number || '';
  document.getElementById('cfg_banner_enabled').checked = !!state.config.banner_enabled;
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
async function saveBannerEnabled() {
  var enabled = document.getElementById('cfg_banner_enabled').checked;
  var res = await supabase.from('store_config').update({ banner_enabled: enabled }).eq('id', true);
  if (res.error) { toast(friendlyError(res.error)); return; }
  state.config.banner_enabled = enabled;
  toast(enabled ? 'Banners ativados.' : 'Banners desativados.');
}

/* ============================================================
   Banners — CRUD
   ============================================================ */
var editingBannerId = null;
var bannerPendingFile = null;
var bannerPendingImageUrl = '';

async function loadBanners() {
  var res = await supabase.from('banners').select('*').order('sort_order');
  if (!res.error) { state.banners = res.data || []; }
  renderBannerList();
}

function renderBannerList() {
  var host = document.getElementById('bannerAdminList');
  if (!host) return;
  if (!state.banners || !state.banners.length) {
    host.innerHTML = '<div class="admin-section-body" style="color:var(--ink-soft);font-size:14px;">Nenhum banner. Clique em "+ Adicionar" para começar.</div>';
    return;
  }
  host.innerHTML = state.banners.map(function (b, idx) {
    var thumb = b.image_url
      ? '<div class="banner-admin-thumb"><img src="' + escapeHtml(b.image_url) + '" alt=""></div>'
      : '<div class="banner-admin-thumb" style="background:var(--accent);"><span style="font-size:18px;">🖼</span></div>';
    return '<div class="banner-admin-row">' +
      thumb +
      '<div class="banner-admin-info">' +
        '<div class="btitle">' + escapeHtml(b.title || '(sem título)') + '</div>' +
        '<div class="bmeta">' + (b.subtitle ? escapeHtml(b.subtitle) : '<em>sem subtítulo</em>') +
          ' &nbsp;·&nbsp; ' + (b.enabled ? '<span style="color:var(--accent);">Ativo</span>' : '<span style="color:var(--ink-faint);">Oculto</span>') +
        '</div>' +
      '</div>' +
      '<div class="banner-admin-actions">' +
        (idx > 0 ? '<button title="Mover para cima" data-move="up" data-bid="' + escapeHtml(b.id) + '">↑</button>' : '') +
        (idx < state.banners.length - 1 ? '<button title="Mover para baixo" data-move="down" data-bid="' + escapeHtml(b.id) + '">↓</button>' : '') +
        '<button title="Editar" data-edit="' + escapeHtml(b.id) + '">✏️</button>' +
        '<button class="danger" title="Excluir" data-del="' + escapeHtml(b.id) + '">🗑</button>' +
      '</div>' +
    '</div>';
  }).join('');

  host.querySelectorAll('[data-edit]').forEach(function (btn) {
    btn.addEventListener('click', function () { openBannerModal(this.getAttribute('data-edit')); });
  });
  host.querySelectorAll('[data-del]').forEach(function (btn) {
    btn.addEventListener('click', function () { deleteBanner(this.getAttribute('data-del')); });
  });
  host.querySelectorAll('[data-move]').forEach(function (btn) {
    btn.addEventListener('click', function () { moveBanner(this.getAttribute('data-bid'), this.getAttribute('data-move')); });
  });
}

async function moveBanner(id, dir) {
  var list = state.banners;
  var idx = list.findIndex(function (b) { return b.id === id; });
  if (idx < 0) return;
  var swapIdx = dir === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= list.length) return;
  var a = list[idx], b = list[swapIdx];
  var tmp = a.sort_order; a.sort_order = b.sort_order; b.sort_order = tmp;
  await supabase.from('banners').update({ sort_order: a.sort_order }).eq('id', a.id);
  await supabase.from('banners').update({ sort_order: b.sort_order }).eq('id', b.id);
  await loadBanners();
}

async function deleteBanner(id) {
  if (!confirm('Excluir este banner?')) return;
  var res = await supabase.from('banners').delete().eq('id', id);
  if (res.error) { toast(friendlyError(res.error)); return; }
  await loadBanners();
  toast('Banner excluído.');
}

async function uploadBannerImage(file) {
  var blob = await fileToResizedBlob(file);
  var path = 'banners/' + Date.now() + '.jpg';
  var up = await supabase.storage.from('product-images').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (up.error) throw up.error;
  return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
}

function openBannerModal(id) {
  editingBannerId = id || null;
  bannerPendingFile = null;
  var b = id ? state.banners.find(function (x) { return x.id === id; }) : null;
  bannerPendingImageUrl = b ? (b.image_url || '') : '';

  var overlay = document.getElementById('bannerModalOverlay');
  document.getElementById('bannerModalTitle').textContent = b ? 'Editar banner' : 'Novo banner';
  document.getElementById('bf_title').value = b ? (b.title || '') : '';
  document.getElementById('bf_subtitle').value = b ? (b.subtitle || '') : '';
  document.getElementById('bf_link').value = b ? (b.link || '') : '';
  document.getElementById('bf_btn').value = b ? (b.btn_text || '') : '';
  document.getElementById('bf_enabled').checked = b ? b.enabled : true;

  var prev = document.getElementById('bfImgPreview');
  prev.innerHTML = bannerPendingImageUrl ? '<img src="' + escapeHtml(bannerPendingImageUrl) + '" style="max-height:80px;border-radius:6px;">' : '';

  var fileInput = document.getElementById('bf_image');
  fileInput.value = '';
  fileInput.onchange = function () {
    var file = fileInput.files[0];
    if (!file) return;
    bannerPendingFile = file;
    var reader = new FileReader();
    reader.onload = function () { prev.innerHTML = '<img src="' + reader.result + '" style="max-height:80px;border-radius:6px;">'; };
    reader.readAsDataURL(file);
  };

  overlay.classList.add('open');
}

function closeBannerModal() {
  document.getElementById('bannerModalOverlay').classList.remove('open');
  editingBannerId = null;
  bannerPendingFile = null;
}

async function saveBannerFromModal() {
  var saveBtn = document.getElementById('saveBannerItemBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Salvando…';
  try {
    var imgUrl = bannerPendingImageUrl;
    if (bannerPendingFile) imgUrl = await uploadBannerImage(bannerPendingFile);
    var data = {
      title:      document.getElementById('bf_title').value.trim(),
      subtitle:   document.getElementById('bf_subtitle').value.trim() || null,
      image_url:  imgUrl || null,
      link:       document.getElementById('bf_link').value.trim() || null,
      btn_text:   document.getElementById('bf_btn').value.trim() || null,
      enabled:    document.getElementById('bf_enabled').checked
    };
    var res;
    if (editingBannerId) {
      res = await supabase.from('banners').update(data).eq('id', editingBannerId);
    } else {
      var maxOrder = state.banners.length ? Math.max.apply(null, state.banners.map(function(b){ return b.sort_order; })) + 1 : 0;
      data.sort_order = maxOrder;
      res = await supabase.from('banners').insert(data);
    }
    if (res.error) { toast(friendlyError(res.error)); return; }
    closeBannerModal();
    await loadBanners();
    toast(editingBannerId ? 'Banner atualizado.' : 'Banner adicionado.');
  } catch (e) {
    toast('Erro ao enviar imagem: ' + e.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Salvar banner';
  }
}

/* ============================================================
   Lista de produtos
   ============================================================ */
var adminFilter = { search: '', category: '' };

function updateCategoryFilterOptions() {
  var sel = document.getElementById('adminCategoryFilter');
  if (!sel) return;
  var current = sel.value;
  var cats = categoriesAdminList();
  sel.innerHTML = '<option value="">Todas as categorias</option>' +
    cats.map(function (c) { return '<option value="' + escapeHtml(c) + '"' + (c === current ? ' selected' : '') + '>' + escapeHtml(c) + '</option>'; }).join('');
}

function renderProductList() {
  var host = document.getElementById('productAdminList');
  updateCategoryFilterOptions();
  var term = adminFilter.search.toLowerCase();
  var cat  = adminFilter.category;
  var filtered = state.products.filter(function (p) {
    var matchSearch = !term ||
      (p.name  && p.name.toLowerCase().includes(term)) ||
      (p.code  && p.code.toLowerCase().includes(term)) ||
      (p.brand && p.brand.toLowerCase().includes(term));
    var matchCat = !cat || p.category === cat;
    return matchSearch && matchCat;
  });
  if (!state.products.length) {
    host.innerHTML = '<div class="admin-section-body" style="color:var(--ink-soft);font-size:14px;">Nenhum produto. Clique em "+ Novo produto" para começar.</div>';
    return;
  }
  if (!filtered.length) {
    host.innerHTML = '<div class="admin-section-body" style="color:var(--ink-soft);font-size:14px;">Nenhum produto encontrado com esses filtros.</div>';
    return;
  }
  var rows = filtered.map(function (p) {
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
        '<div class="field"><label>Marca</label>' +
          '<select id="f_brand">' +
            '<option value="">— sem marca —</option>' +
            state.brands.map(function (b) {
              var sel = p && p.brand === b.name ? ' selected' : '';
              return '<option value="' + escapeHtml(b.name) + '"' + sel + '>' + escapeHtml(b.name) + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div class="field"><label>Categoria</label>' +
        '<select id="f_category">' +
          '<option value="">— sem categoria —</option>' +
          state.categories.map(function (c) {
            var sel = p && p.category === c.name ? ' selected' : '';
            return '<option value="' + escapeHtml(c.name) + '"' + sel + '>' + escapeHtml(c.name) + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
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
      '<label class="checkbox-row"><input type="checkbox" id="f_promoted"' + (p && p.promoted ? ' checked' : '') + '> Destacar na vitrine (★)</label>' +
      '<label class="checkbox-row"><input type="checkbox" id="f_show_price"' + (p && p.show_price === false ? '' : ' checked') + '> Exibir preço para o cliente no catálogo</label>' +
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
        '<div class="field"><label>Estoque reservado (inf.)</label><span style="font-size:12px;color:var(--ink-faint);padding-top:6px;">Use os checkboxes na aba Dados gerais</span></div>' +
      '</div>' +
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
   Marcas — CRUD
   ============================================================ */
var editingBrandId = null;

async function loadBrands() {
  var res = await supabase.from('brands').select('*').order('sort_order').order('name');
  if (!res.error) state.brands = res.data || [];
  renderBrandList();
}

function renderBrandList() {
  var host = document.getElementById('brandAdminList');
  if (!host) return;
  if (!state.brands.length) {
    host.innerHTML = '<div class="admin-section-body" style="color:var(--ink-soft);font-size:14px;">Nenhuma marca. Clique em "+ Nova marca" para começar.</div>';
    return;
  }
  host.innerHTML = state.brands.map(function (b, idx) {
    return '<div class="banner-admin-row">' +
      '<div class="banner-admin-thumb" style="background:var(--paper-2);font-size:18px;">🏢</div>' +
      '<div class="banner-admin-info"><div class="btitle">' + escapeHtml(b.name) + '</div></div>' +
      '<div class="banner-admin-actions">' +
        (idx > 0 ? '<button title="Mover para cima" data-bmove="up" data-bid="' + escapeHtml(b.id) + '">↑</button>' : '') +
        (idx < state.brands.length - 1 ? '<button title="Mover para baixo" data-bmove="down" data-bid="' + escapeHtml(b.id) + '">↓</button>' : '') +
        '<button title="Renomear" data-bedit="' + escapeHtml(b.id) + '">✏️</button>' +
        '<button class="danger" title="Excluir" data-bdel="' + escapeHtml(b.id) + '">🗑</button>' +
      '</div></div>';
  }).join('');
  host.querySelectorAll('[data-bedit]').forEach(function (btn) {
    btn.addEventListener('click', function () { openBrandModal(this.getAttribute('data-bedit')); });
  });
  host.querySelectorAll('[data-bdel]').forEach(function (btn) {
    btn.addEventListener('click', function () { deleteBrand(this.getAttribute('data-bdel')); });
  });
  host.querySelectorAll('[data-bmove]').forEach(function (btn) {
    btn.addEventListener('click', function () { moveBrand(this.getAttribute('data-bid'), this.getAttribute('data-bmove')); });
  });
}

async function moveBrand(id, dir) {
  var list = state.brands;
  var idx = list.findIndex(function (b) { return b.id === id; });
  if (idx < 0) return;
  var swapIdx = dir === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= list.length) return;
  var a = list[idx], b = list[swapIdx];
  var tmp = a.sort_order; a.sort_order = b.sort_order; b.sort_order = tmp;
  await supabase.from('brands').update({ sort_order: a.sort_order }).eq('id', a.id);
  await supabase.from('brands').update({ sort_order: b.sort_order }).eq('id', b.id);
  await loadBrands();
}

async function deleteBrand(id) {
  var brand = state.brands.find(function (b) { return b.id === id; });
  if (!confirm('Excluir a marca "' + (brand ? brand.name : '') + '"?\n\nOs produtos com essa marca não serão excluídos.')) return;
  var res = await supabase.from('brands').delete().eq('id', id);
  if (res.error) { toast(friendlyError(res.error)); return; }
  toast('Marca excluída.');
  await loadBrands();
}

function openBrandModal(id) {
  editingBrandId = id || null;
  var brand = id ? state.brands.find(function (b) { return b.id === id; }) : null;
  document.getElementById('brandModalTitle').textContent = brand ? 'Renomear marca' : 'Nova marca';
  document.getElementById('brd_name').value = brand ? brand.name : '';
  document.getElementById('brandModalOverlay').classList.add('open');
  setTimeout(function () { document.getElementById('brd_name').focus(); }, 100);
}

function closeBrandModal() {
  document.getElementById('brandModalOverlay').classList.remove('open');
  editingBrandId = null;
}

async function saveBrandFromModal() {
  var name = document.getElementById('brd_name').value.trim();
  if (!name) { toast('Informe o nome da marca.'); return; }
  var btn = document.getElementById('saveBrandBtn');
  btn.disabled = true;
  var res;
  if (editingBrandId) {
    res = await supabase.from('brands').update({ name: name }).eq('id', editingBrandId);
  } else {
    var maxOrder = state.brands.length ? Math.max.apply(null, state.brands.map(function (b) { return b.sort_order; })) + 1 : 0;
    res = await supabase.from('brands').insert({ name: name, sort_order: maxOrder });
  }
  btn.disabled = false;
  if (res.error) { toast(friendlyError(res.error)); return; }
  closeBrandModal();
  toast(editingBrandId ? 'Marca renomeada.' : 'Marca criada.');
  await loadBrands();
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
  await Promise.all([loadProducts(), loadConfig(), loadOrders(), loadBanners(), loadCategories(), loadBrands()]);
}

/* ============================================================
   Realtime
   ============================================================ */
function subscribeRealtime() {
  supabase.channel('admin-products').on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, function () { loadProducts(); }).subscribe();
  supabase.channel('admin-orders').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, function () { loadOrders(); }).subscribe();
  supabase.channel('admin-config').on('postgres_changes', { event: '*', schema: 'public', table: 'store_config' }, function () { loadConfig(); }).subscribe();
  supabase.channel('admin-banners').on('postgres_changes', { event: '*', schema: 'public', table: 'banners' }, function () { loadBanners(); }).subscribe();
  supabase.channel('admin-categories').on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, function () { loadCategories(); }).subscribe();
  supabase.channel('admin-brands').on('postgres_changes', { event: '*', schema: 'public', table: 'brands' }, function () { loadBrands(); }).subscribe();
}

/* ============================================================
   Categorias — CRUD
   ============================================================ */
var editingCategoryId = null;

async function loadCategories() {
  var res = await supabase.from('categories').select('*').order('sort_order').order('name');
  if (!res.error) state.categories = res.data || [];
  renderCategoryList();
  updateCategoryFilterOptions();
}

function renderCategoryList() {
  var host = document.getElementById('categoryAdminList');
  if (!host) return;
  if (!state.categories.length) {
    host.innerHTML = '<div class="admin-section-body" style="color:var(--ink-soft);font-size:14px;">Nenhuma categoria. Clique em "+ Nova categoria" para começar.</div>';
    return;
  }
  host.innerHTML = state.categories.map(function (c, idx) {
    return '<div class="banner-admin-row">' +
      '<div class="banner-admin-thumb" style="background:var(--paper-2);font-size:18px;">🏷</div>' +
      '<div class="banner-admin-info"><div class="btitle">' + escapeHtml(c.name) + '</div></div>' +
      '<div class="banner-admin-actions">' +
        (idx > 0 ? '<button title="Mover para cima" data-cmove="up" data-cid="' + escapeHtml(c.id) + '">↑</button>' : '') +
        (idx < state.categories.length - 1 ? '<button title="Mover para baixo" data-cmove="down" data-cid="' + escapeHtml(c.id) + '">↓</button>' : '') +
        '<button title="Renomear" data-cedit="' + escapeHtml(c.id) + '">✏️</button>' +
        '<button class="danger" title="Excluir" data-cdel="' + escapeHtml(c.id) + '">🗑</button>' +
      '</div></div>';
  }).join('');
  host.querySelectorAll('[data-cedit]').forEach(function (btn) {
    btn.addEventListener('click', function () { openCategoryModal(this.getAttribute('data-cedit')); });
  });
  host.querySelectorAll('[data-cdel]').forEach(function (btn) {
    btn.addEventListener('click', function () { deleteCategory(this.getAttribute('data-cdel')); });
  });
  host.querySelectorAll('[data-cmove]').forEach(function (btn) {
    btn.addEventListener('click', function () { moveCategory(this.getAttribute('data-cid'), this.getAttribute('data-cmove')); });
  });
}

async function moveCategory(id, dir) {
  var list = state.categories;
  var idx = list.findIndex(function (c) { return c.id === id; });
  if (idx < 0) return;
  var swapIdx = dir === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= list.length) return;
  var a = list[idx], b = list[swapIdx];
  var tmp = a.sort_order; a.sort_order = b.sort_order; b.sort_order = tmp;
  await supabase.from('categories').update({ sort_order: a.sort_order }).eq('id', a.id);
  await supabase.from('categories').update({ sort_order: b.sort_order }).eq('id', b.id);
  await loadCategories();
}

async function deleteCategory(id) {
  var cat = state.categories.find(function (c) { return c.id === id; });
  if (!confirm('Excluir a categoria "' + (cat ? cat.name : '') + '"?\n\nOs produtos com essa categoria não serão excluídos.')) return;
  var res = await supabase.from('categories').delete().eq('id', id);
  if (res.error) { toast(friendlyError(res.error)); return; }
  toast('Categoria excluída.');
  await loadCategories();
}

function openCategoryModal(id) {
  editingCategoryId = id || null;
  var cat = id ? state.categories.find(function (c) { return c.id === id; }) : null;
  document.getElementById('categoryModalTitle').textContent = cat ? 'Renomear categoria' : 'Nova categoria';
  document.getElementById('cf_name').value = cat ? cat.name : '';
  document.getElementById('categoryModalOverlay').classList.add('open');
  setTimeout(function () { document.getElementById('cf_name').focus(); }, 100);
}

function closeCategoryModal() {
  document.getElementById('categoryModalOverlay').classList.remove('open');
  editingCategoryId = null;
}

async function saveCategoryFromModal() {
  var name = document.getElementById('cf_name').value.trim();
  if (!name) { toast('Informe o nome da categoria.'); return; }
  var btn = document.getElementById('saveCategoryBtn');
  btn.disabled = true;
  var res;
  if (editingCategoryId) {
    res = await supabase.from('categories').update({ name: name }).eq('id', editingCategoryId);
  } else {
    var maxOrder = state.categories.length ? Math.max.apply(null, state.categories.map(function (c) { return c.sort_order; })) + 1 : 0;
    res = await supabase.from('categories').insert({ name: name, sort_order: maxOrder });
  }
  btn.disabled = false;
  if (res.error) { toast(friendlyError(res.error)); return; }
  closeCategoryModal();
  toast(editingCategoryId ? 'Categoria renomeada.' : 'Categoria criada.');
  await loadCategories();
}

/* ============================================================
   Ações em massa
   ============================================================ */
async function hideAllPrices() {
  if (!confirm('Ocultar o preço de TODOS os produtos para os clientes?\n\nEles ainda aparecerão no catálogo, mas sem exibir o valor.')) return;
  var btn = document.getElementById('hideAllPricesBtn');
  btn.disabled = true;
  btn.textContent = 'Ocultando…';
  var res = await supabase.from('products').update({ show_price: false }).neq('id', '00000000-0000-0000-0000-000000000000');
  btn.disabled = false;
  btn.textContent = 'Ocultar todos os preços';
  if (res.error) { toast(friendlyError(res.error)); return; }
  toast('Preços ocultados em todos os produtos.');
  await loadProducts();
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
  document.querySelectorAll('.nav-item[data-panel]').forEach(function (btn) {
    btn.addEventListener('click', function () { showPanel(this.getAttribute('data-panel')); });
  });
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('login_password').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  document.getElementById('logoutBtn').addEventListener('click', doLogout);
  document.getElementById('newProductBtn').addEventListener('click', function () { openProductModal(null); });
  document.getElementById('hideAllPricesBtn').addEventListener('click', hideAllPrices);
  document.getElementById('adminSearchInput').addEventListener('input', function () {
    adminFilter.search = this.value;
    renderProductList();
  });
  document.getElementById('adminCategoryFilter').addEventListener('change', function () {
    adminFilter.category = this.value;
    renderProductList();
  });
  document.getElementById('saveConfigBtn').addEventListener('click', saveConfig);
  document.getElementById('saveBannerEnabledBtn').addEventListener('click', saveBannerEnabled);
  document.getElementById('addCategoryBtn').addEventListener('click', function () { openCategoryModal(null); });
  document.getElementById('closeCategoryModalBtn').addEventListener('click', closeCategoryModal);
  document.getElementById('cancelCategoryBtn').addEventListener('click', closeCategoryModal);
  document.getElementById('saveCategoryBtn').addEventListener('click', saveCategoryFromModal);
  document.getElementById('cf_name').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveCategoryFromModal(); });
  document.getElementById('addBrandBtn').addEventListener('click', function () { openBrandModal(null); });
  document.getElementById('closeBrandModalBtn').addEventListener('click', closeBrandModal);
  document.getElementById('cancelBrandBtn').addEventListener('click', closeBrandModal);
  document.getElementById('saveBrandBtn').addEventListener('click', saveBrandFromModal);
  document.getElementById('brd_name').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveBrandFromModal(); });
  document.getElementById('addBannerBtn').addEventListener('click', function () { openBannerModal(null); });
  document.getElementById('closeBannerModalBtn').addEventListener('click', closeBannerModal);
  document.getElementById('cancelBannerBtn').addEventListener('click', closeBannerModal);
  document.getElementById('saveBannerItemBtn').addEventListener('click', saveBannerFromModal);
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
