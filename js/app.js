import { supabase } from './supabaseClient.js';

/* ============================================================
   Estado
   ============================================================ */
var state = {
  products: [],
  categories: [],
  brands: [],
  config: { store_name: 'Connect X Atacado', whatsapp_number: '' },
  cart: {},
  activeCategory: 'all',
  activeBrand: null,
  searchTerm: '',
  _nudge: null
};

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
  setTimeout(function () {
    el.classList.remove('show');
    setTimeout(function () { el.remove(); }, 300);
  }, 3200);
}
function saveCartLocal() {
  try { localStorage.setItem('cxa_cart', JSON.stringify(state.cart)); } catch (e) {}
}
function loadCartLocal() {
  try {
    var raw = localStorage.getItem('cxa_cart');
    if (raw) state.cart = JSON.parse(raw) || {};
  } catch (e) { state.cart = {}; }
}
function friendlyError(err) {
  var msg = (err && (err.message || err.error_description)) || '';
  if (/row-level security|permission|policy/i.test(msg)) return 'Não foi possível concluir a ação agora. Tente novamente.';
  if (/JWT|auth/i.test(msg)) return 'Sua sessão expirou. Tente novamente.';
  return msg || 'Não foi possível concluir a ação agora.';
}
function statusLabel(s) {
  return { aguardando: 'Aguardando', confirmado: 'Confirmado', enviado: 'Enviado', cancelado: 'Cancelado' }[s] || 'Aguardando';
}

/* ============================================================
   Derivação de listas
   ============================================================ */
function visibleProducts() {
  return state.products.filter(function (p) { return !p.hidden; });
}
function categoriesList() {
  var source = state.activeBrand
    ? visibleProducts().filter(function (p) { return p.brand === state.activeBrand; })
    : visibleProducts();
  var productCats = {};
  source.forEach(function (p) { if (p.category) productCats[p.category] = true; });
  if (state.categories && state.categories.length) {
    var regular = state.categories.filter(function (c) { return c.name !== 'Outlet' && productCats[c.name]; });
    var outlet  = state.categories.filter(function (c) { return c.name === 'Outlet'  && productCats[c.name]; });
    return regular.concat(outlet).map(function (c) { return c.name; });
  }
  var set = {};
  source.forEach(function (p) { if (p.category) set[p.category] = true; });
  return Object.keys(set).sort();
}
function filteredForGrid() {
  var list = visibleProducts();
  if (state.activeBrand) {
    list = list.filter(function (p) { return p.brand === state.activeBrand; });
  }
  if (state.activeCategory === 'destaques') {
    list = list.filter(function (p) { return p.promoted; });
  } else if (state.activeCategory !== 'all') {
    list = list.filter(function (p) { return p.category === state.activeCategory; });
  }
  var term = state.searchTerm.trim().toLowerCase();
  if (term) {
    list = list.filter(function (p) {
      return (p.name || '').toLowerCase().indexOf(term) > -1 ||
             (p.code || '').toLowerCase().indexOf(term) > -1 ||
             (p.brand || '').toLowerCase().indexOf(term) > -1 ||
             (p.category || '').toLowerCase().indexOf(term) > -1;
    });
  }
  return list;
}


/* ============================================================
   Chips de categoria
   ============================================================ */
function renderChips() {
  var host = document.getElementById('chiprow');
  var brandHtml = '';
  if (state.brands.length > 1) {
    var brandChips = [{ key: null, label: 'Todas as marcas' }].concat(
      state.brands.map(function (b) { return { key: b.name, label: b.name }; })
    );
    brandHtml = '<div class="chiprow-brand">' + brandChips.map(function (b) {
      var active = state.activeBrand === b.key ? ' active' : '';
      return '<button type="button" class="chip chip-brand' + active + '" data-brand="' + escapeHtml(b.key || '') + '">' + escapeHtml(b.label) + '</button>';
    }).join('') + '</div>';
  }

  var cats = categoriesList();
  var hasPromo = (state.activeBrand
    ? visibleProducts().filter(function (p) { return p.brand === state.activeBrand; })
    : visibleProducts()
  ).some(function (p) { return p.promoted; });
  var chips = [{ key: 'all', label: 'Todos', outlet: false }];
  if (hasPromo) chips.push({ key: 'destaques', label: '★ Destaques', outlet: false });
  cats.forEach(function (c) { chips.push({ key: c, label: c, outlet: c === 'Outlet' }); });
  var catHtml = chips.map(function (c) {
    var active = state.activeCategory === c.key ? ' active' : '';
    var cls = 'chip' + (c.outlet ? ' chip-outlet' : '') + active;
    return '<button type="button" class="' + cls + '" data-category="' + escapeHtml(c.key) + '">' + escapeHtml(c.label) + '</button>';
  }).join('');

  host.innerHTML = brandHtml + catHtml;

  Array.prototype.forEach.call(host.querySelectorAll('[data-brand]'), function (btn) {
    btn.addEventListener('click', function () {
      state.activeBrand = btn.getAttribute('data-brand') || null;
      state.activeCategory = 'all';
      renderChips();
      renderCatalog();
    });
  });
  Array.prototype.forEach.call(host.querySelectorAll('[data-category]'), function (btn) {
    btn.addEventListener('click', function () {
      state.activeCategory = btn.getAttribute('data-category');
      renderChips();
      renderCatalog();
    });
  });
}

/* ============================================================
   Cartão de produto (catálogo público)
   ============================================================ */
function productCardHtml(p) {
  var qty = state.cart[p.id] || 0;
  var img = p.image_url
    ? '<img src="' + p.image_url + '" alt="' + escapeHtml(p.name) + '" loading="lazy">'
    : '<div class="noimg">sem imagem</div>';
  var promoBadge = p.promoted ? '<span class="badge badge-promo promo-flag">★ destaque</span>' : '';
  var inCart = qty > 0;
  var showPrice = p.show_price !== false;
  var hasSale = showPrice && p.sale_price && Number(p.sale_price) > 0;
  var priceHtml = hasSale
    ? '<span class="price-strike">' + fmtBRL(p.price) + '</span><span class="price-sale">' + fmtBRL(p.sale_price) + '</span>'
    : '<span class="price">' + fmtBRL(p.price) + '</span>';
  var minQtyHtml = (p.min_qty && p.min_qty > 1)
    ? '<div><span class="min-qty-badge">mín. ' + p.min_qty + ' ' + escapeHtml(p.unit || 'un') + '</span></div>'
    : '';
  return (
    '<div class="card" data-id="' + p.id + '">' +
      '<div class="imgwrap">' + img + promoBadge + '</div>' +
      '<div class="body">' +
        '<h3 class="card-name">' + escapeHtml(p.name) + '</h3>' +
        (p.description ? '<div class="desc">' + escapeHtml(p.description) + '</div>' : '') +
        (showPrice
          ? '<div class="price-row">' + priceHtml + (p.stock === 'sob_consulta' ? '<span class="badge badge-alert" style="font-size:10px;">sob consulta</span>' : '') + '</div>' + minQtyHtml
          : '<div class="price-hidden-note">Consulte o preço no carrinho</div>'
        ) +
        '<button type="button" class="btn-cart' + (inCart ? ' in-cart' : '') + '" data-add="' + p.id + '">' +
          (inCart ? '✓ No carrinho (' + qty + ')' : '+ Carrinho') +
        '</button>' +
      '</div>' +
    '</div>'
  );
}

/* ============================================================
   Catálogo
   ============================================================ */
function renderCatalog() {
  var root = document.getElementById('catalogRoot');
  if (!visibleProducts().length) {
    root.innerHTML = '<div class="empty">Nenhum produto cadastrado ainda. Volte em breve.</div>';
    return;
  }

  var html = '';

  if (state.activeCategory === 'destaques') {
    var promo = filteredForGrid().filter(function (p) { return p.promoted; });
    html = '<div class="section-head"><h2>★ Destaques</h2><span class="count">' + promo.length + ' item(ns)</span></div>' +
      (promo.length ? '<div class="grid">' + promo.map(productCardHtml).join('') + '</div>' : '<div class="empty">Nenhum destaque no momento.</div>');
    root.innerHTML = html;
    bindCardEvents(root);
    return;
  }

  var list = filteredForGrid();
  var promoted = list.filter(function (p) { return p.promoted; });
  var rest = list.filter(function (p) { return !p.promoted; });

  if (promoted.length && state.activeCategory === 'all' && !state.searchTerm.trim()) {
    html += '<div class="section-head"><h2>★ Destaques</h2><span class="count">' + promoted.length + ' item(ns)</span></div>';
    html += '<div class="grid">' + promoted.map(productCardHtml).join('') + '</div>';
  }
  var sectionTitle = state.activeCategory === 'all' ? 'Todos os produtos' : escapeHtml(state.activeCategory);
  var restList = (state.activeCategory === 'all' && !state.searchTerm.trim()) ? rest : list;
  html += '<div class="section-head"><h2>' + sectionTitle + '</h2><span class="count">' + restList.length + ' item(ns)</span></div>';
  html += restList.length
    ? '<div class="grid">' + restList.map(productCardHtml).join('') + '</div>'
    : '<div class="empty">Nenhum produto nesta categoria.</div>';

  root.innerHTML = html;
  bindCardEvents(root);
}

function bindCardEvents(root) {
  Array.prototype.forEach.call(root.querySelectorAll('[data-add]'), function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-add');
      var currentQty = state.cart[id] || 0;
      addToCart(id, currentQty + 1);
    });
  });
}

/* ============================================================
   Carrinho
   ============================================================ */
function addToCart(id, qty) {
  var product = state.products.filter(function (p) { return p.id === id; })[0];
  if (!product) return;
  if (qty <= 0) delete state.cart[id]; else state.cart[id] = qty;
  saveCartLocal();
  renderCatalog();
  renderCartCount();
  if (qty > 0) {
    toast(qty + 'x ' + product.name + ' adicionado ao carrinho.');
    var promo = state.products.filter(function (p) {
      return p.promoted && !p.hidden && p.id !== id && !state.cart[p.id];
    })[0];
    if (promo) state._nudge = promo;
  }
}
function renderCartCount() {
  var count = Object.keys(state.cart).reduce(function (sum, id) { return sum + state.cart[id]; }, 0);
  var el = document.getElementById('cartCount');
  if (count > 0) { el.style.display = 'flex'; el.textContent = count; } else { el.style.display = 'none'; }
}
function cartItems() {
  return Object.keys(state.cart).map(function (id) {
    var p = state.products.filter(function (pp) { return pp.id === id; })[0];
    if (!p) return null;
    return { id: id, code: p.code, name: p.name, brand: p.brand, price: Number(p.price), image_url: p.image_url, qty: state.cart[id] };
  }).filter(Boolean);
}
function renderCart() {
  var items = cartItems();
  var body = document.getElementById('cartBody');
  var foot = document.getElementById('cartFoot');
  if (!items.length) {
    body.innerHTML = '<div class="empty">Seu carrinho está vazio. Adicione produtos do catálogo.</div>';
    foot.innerHTML = '';
    return;
  }
  body.innerHTML = items.map(function (it) {
    var thumb = it.image_url ? '<img src="' + it.image_url + '" alt="">' : '';
    return (
      '<div class="cart-line" data-id="' + it.id + '">' +
        '<div class="thumb">' + thumb + '</div>' +
        '<div class="info">' +
          '<div class="n">' + escapeHtml(it.name) + '</div>' +
          '<div class="c mono">cód. ' + escapeHtml(it.code || '-') + ' · ' + escapeHtml(it.brand || '') + '</div>' +
          '<div class="row2">' +
            '<div class="stepper">' +
              '<button type="button" data-cstep="-1" data-id="' + it.id + '">−</button>' +
              '<span class="mono" style="min-width:26px;text-align:center;display:inline-block;">' + it.qty + '</span>' +
              '<button type="button" data-cstep="1" data-id="' + it.id + '">+</button>' +
            '</div>' +
            '<div class="linetotal mono">' + fmtBRL(it.price * it.qty) + '</div>' +
          '</div>' +
          '<button type="button" class="remove-link" data-remove="' + it.id + '">remover</button>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  var total = items.reduce(function (sum, it) { return sum + it.price * it.qty; }, 0);
  var nudgeHtml = '';
  if (state._nudge && !state.cart[state._nudge.id]) {
    nudgeHtml = '<div class="nudge"><span>Aproveite e leve <strong>' + escapeHtml(state._nudge.name) + '</strong> também.</span><button type="button" class="btn btn-sm" id="nudgeAddBtn">Adicionar</button></div>';
  }
  foot.innerHTML = nudgeHtml +
    '<div class="subtotal-row"><span>Total</span><span class="mono">' + fmtBRL(total) + '</span></div>' +
    '<button type="button" class="btn btn-accent" id="goCheckoutBtn" style="justify-content:center;">Finalizar pedido</button>';

  Array.prototype.forEach.call(body.querySelectorAll('[data-cstep]'), function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-id');
      var newQty = (state.cart[id] || 0) + parseInt(btn.getAttribute('data-cstep'), 10);
      if (newQty <= 0) delete state.cart[id]; else state.cart[id] = newQty;
      saveCartLocal(); renderCart(); renderCartCount(); renderCatalog();
    });
  });
  Array.prototype.forEach.call(body.querySelectorAll('[data-remove]'), function (btn) {
    btn.addEventListener('click', function () {
      delete state.cart[btn.getAttribute('data-remove')];
      saveCartLocal(); renderCart(); renderCartCount(); renderCatalog();
    });
  });
  var nudgeBtn = document.getElementById('nudgeAddBtn');
  if (nudgeBtn) nudgeBtn.addEventListener('click', function () {
    state.cart[state._nudge.id] = 1;
    saveCartLocal(); renderCart(); renderCartCount(); renderCatalog();
  });
  var goCheckout = document.getElementById('goCheckoutBtn');
  if (goCheckout) goCheckout.addEventListener('click', openCheckoutModal);
}
function openCart() {
  renderCart();
  document.getElementById('cartOverlay').classList.add('open');
  document.getElementById('cartDrawer').classList.add('open');
}
function closeCart() {
  document.getElementById('cartOverlay').classList.remove('open');
  document.getElementById('cartDrawer').classList.remove('open');
}

/* ============================================================
   Checkout
   ============================================================ */
function openCheckoutModal() {
  var items = cartItems();
  if (!items.length) return;
  var body = document.getElementById('checkoutModalBody');
  var total = items.reduce(function (sum, it) { return sum + it.price * it.qty; }, 0);
  body.innerHTML =
    '<div class="eyebrow">Antes de finalizar…</div>' +
    '<div class="field"><label>Seu nome *</label><input type="text" id="co_customer" placeholder="Ex: João Silva"><div class="required-note" id="co_nameError" style="display:none;">Informe seu nome</div></div>' +
    '<div class="field"><label>Seu WhatsApp (opcional)</label><input type="tel" id="co_phone" placeholder="(11) 99999-9999"></div>' +
    '<div class="field"><label>Observações (opcional)</label><textarea id="co_notes" placeholder="Cor, urgência, combinação de itens..."></textarea></div>' +
    '<div style="border-top:1px solid var(--line);padding-top:12px;">' +
      items.map(function (it) {
        return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;"><span>' + it.qty + 'x ' + escapeHtml(it.name) + '</span><span class="mono">' + fmtBRL(it.price * it.qty) + '</span></div>';
      }).join('') +
      '<div style="display:flex;justify-content:space-between;font-weight:600;padding-top:8px;"><span>Total</span><span class="mono">' + fmtBRL(total) + '</span></div>' +
    '</div>' +
    (state.config.whatsapp_number ? '' : '<div class="required-note">A equipe Connect X ainda não configurou o WhatsApp de recebimento — o pedido será apenas registrado.</div>');
  document.getElementById('checkoutModalOverlay').classList.add('open');
}
function closeCheckoutModal() {
  document.getElementById('checkoutModalOverlay').classList.remove('open');
}
async function confirmCheckout() {
  var items = cartItems();
  if (!items.length) return;
  var customer = document.getElementById('co_customer').value.trim();
  if (!customer) {
    document.getElementById('co_nameError').style.display = 'block';
    document.getElementById('co_customer').focus();
    return;
  }
  var phone = document.getElementById('co_phone').value.trim();
  var notes = document.getElementById('co_notes').value.trim();
  var total = items.reduce(function (sum, it) { return sum + it.price * it.qty; }, 0);

  var confirmBtn = document.getElementById('confirmCheckoutBtn');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Gerando…';

  var payload = {
    customer_name: customer,
    customer_phone: phone,
    notes: notes,
    items: items.map(function (it) { return { name: it.name, code: it.code, brand: it.brand, price: it.price, qty: it.qty }; }),
    total: total
  };

  try {
    var res = await supabase.from('orders').insert([payload]).select().single();
    if (res.error) throw res.error;
    var order = res.data;
    var link = window.location.origin + window.location.pathname + '#pedido/' + order.id;

    state.cart = {};
    saveCartLocal();
    closeCheckoutModal();
    closeCart();

    if (state.config.whatsapp_number) {
      var lines = [
        'Olá! Sou *' + order.customer_name + '*. Gostaria de finalizar meu pedido:',
        ''
      ];
      order.items.forEach(function (it) { lines.push('• ' + it.qty + 'x ' + it.name + ' — ' + fmtBRL(it.price * it.qty)); });
      lines.push('');
      lines.push('*Total: ' + fmtBRL(order.total) + '*');
      if (order.notes) { lines.push(''); lines.push('Obs: ' + order.notes); }
      lines.push('');
      lines.push('Ver pedido: ' + link);
      window.location.href = 'https://wa.me/' + state.config.whatsapp_number + '?text=' + encodeURIComponent(lines.join('\n'));
    } else {
      renderCartCount();
      renderCatalog();
      window.location.hash = 'pedido/' + order.id;
    }
  } catch (err) {
    toast(friendlyError(err));
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Gerar pedido';
  }
}

/* ============================================================
   Página de confirmação do pedido (rota via hash)
   ============================================================ */
function showOrderView(order) {
  document.getElementById('chiprow').style.display = 'none';
  document.getElementById('catalogRoot').style.display = 'none';
  var root = document.getElementById('orderViewRoot');
  root.style.display = 'block';
  var itemsHtml = order.items.map(function (it) {
    return '<div class="order-line"><div><div class="n">' + escapeHtml(it.name) + '</div><div class="q mono">' + it.qty + 'x ' + fmtBRL(it.price) + '</div></div><div class="mono">' + fmtBRL(it.price * it.qty) + '</div></div>';
  }).join('');
  var dateStr = new Date(order.created_at).toLocaleString('pt-BR');
  var talkUrl = state.config.whatsapp_number
    ? 'https://wa.me/' + state.config.whatsapp_number + '?text=' + encodeURIComponent('Olá! Sobre o pedido de ' + order.customer_name + ' (' + dateStr + ').')
    : null;
  root.innerHTML =
    '<div class="app order-view">' +
      '<div class="order-card">' +
        '<div class="order-head">' +
          '<div><h1>Pedido</h1><div class="sub">' + escapeHtml(order.customer_name) + '</div></div>' +
          '<span class="badge badge-alert">' + statusLabel(order.status) + '</span>' +
        '</div>' +
        '<div class="order-items">' + itemsHtml + '</div>' +
        '<div class="order-meta">' +
          '<div><div class="k">Data do pedido</div><div>' + escapeHtml(dateStr) + '</div></div>' +
          (order.notes ? '<div><div class="k">Observações</div><div>' + escapeHtml(order.notes) + '</div></div>' : '<div></div>') +
        '</div>' +
        '<div class="order-total-row"><span>Total do pedido</span><span class="mono">' + fmtBRL(order.total) + '</span></div>' +
        '<div class="order-actions">' +
          '<button type="button" class="btn btn-ghost" id="printOrderBtn">🖨️ Imprimir pedido</button>' +
          (talkUrl ? '<a class="btn btn-accent" href="' + talkUrl + '" target="_blank" rel="noopener" style="text-decoration:none;">Falar com a loja</a>' : '') +
        '</div>' +
      '</div>' +
      '<button type="button" class="back-link" id="backToCatalogBtn">← Voltar ao catálogo</button>' +
    '</div>';
  document.getElementById('printOrderBtn').addEventListener('click', function () { window.print(); });
  document.getElementById('backToCatalogBtn').addEventListener('click', function () { window.location.hash = ''; });
}
function showCatalogView() {
  document.getElementById('orderViewRoot').style.display = 'none';
  document.getElementById('orderViewRoot').innerHTML = '';
  document.getElementById('chiprow').style.display = '';
  document.getElementById('catalogRoot').style.display = '';
}
async function routeFromHash() {
  var h = window.location.hash || '';
  var m = h.match(/^#pedido\/([0-9a-fA-F-]+)$/);
  if (m) {
    var res = await supabase.rpc('get_order', { order_id: m[1] });
    var order = res.data && res.data[0];
    if (order) { showOrderView(order); return; }
    toast('Pedido não encontrado.');
  }
  showCatalogView();
}

/* ============================================================
   Carregamento de dados
   ============================================================ */
async function loadBrands() {
  var res = await supabase.from('brands').select('*').order('sort_order').order('name');
  if (!res.error) state.brands = res.data || [];
  renderChips();
  renderCatalog();
}
async function loadCategories() {
  var res = await supabase.from('categories').select('*').order('sort_order').order('name');
  if (!res.error) state.categories = res.data || [];
  renderChips();
  renderCatalog();
}
async function loadProducts() {
  var res = await supabase.from('products').select('*').order('created_at', { ascending: false });
  if (res.error) { console.error(res.error); return; }
  state.products = res.data || [];
  renderChips();
  renderCatalog();
}
async function loadConfig() {
  var res = await supabase.from('store_config').select('*').eq('id', true).single();
  if (!res.error && res.data) {
    state.config = res.data;
    await loadAndRenderBanners(res.data);
  }
}

async function loadAndRenderBanners(cfg) {
  var el = document.getElementById('siteBanner');
  if (!el) return;
  if (sessionStorage.getItem('banner_dismissed') === '1') { el.style.display = 'none'; return; }
  if (!cfg || !cfg.banner_enabled) { el.style.display = 'none'; return; }
  var res = await supabase.from('banners').select('*').eq('enabled', true).order('sort_order');
  var banners = (!res.error && res.data) ? res.data : [];
  if (!banners.length) { el.style.display = 'none'; return; }
  renderCarousel(el, banners);
}

function renderCarousel(el, banners) {
  var track  = document.getElementById('bannerTrack');
  var dotsEl = document.getElementById('bannerDots');
  var prevBtn = document.getElementById('bannerPrev');
  var nextBtn = document.getElementById('bannerNext');
  var total = banners.length;
  var current = 0;
  var timer = null;

  track.innerHTML = banners.map(function (b) {
    var imgStyle = b.image_url
      ? 'background-image:linear-gradient(135deg,rgba(0,0,0,.48),rgba(0,0,0,.18)),url(' + escapeHtml(b.image_url) + ');background-size:cover;background-position:center;'
      : '';
    var cta = b.link
      ? '<a class="site-banner-cta" href="' + escapeHtml(b.link) + '" target="_blank" rel="noopener">' + escapeHtml(b.btn_text || 'Ver mais') + '</a>'
      : '';
    return '<div class="banner-slide' + (b.image_url ? ' has-image' : '') + '" style="' + imgStyle + '">' +
      '<div class="banner-slide-inner">' +
        '<div class="site-banner-text">' +
          '<p class="site-banner-title">' + escapeHtml(b.title || '') + '</p>' +
          (b.subtitle ? '<p class="site-banner-sub">' + escapeHtml(b.subtitle) + '</p>' : '') +
        '</div>' + cta +
      '</div></div>';
  }).join('');

  function goTo(idx) {
    current = ((idx % total) + total) % total;
    track.style.transform = 'translateX(-' + (current * 100) + '%)';
    Array.prototype.forEach.call(dotsEl.querySelectorAll('.banner-dot'), function (d, i) {
      d.classList.toggle('active', i === current);
    });
  }

  function startTimer() {
    clearInterval(timer);
    if (total > 1) timer = setInterval(function () { goTo(current + 1); }, 5000);
  }

  if (total > 1) {
    dotsEl.innerHTML = banners.map(function (_, i) {
      return '<button class="banner-dot' + (i === 0 ? ' active' : '') + '" data-i="' + i + '" aria-label="Banner ' + (i + 1) + '"></button>';
    }).join('');
    dotsEl.style.display = '';
    prevBtn.style.display = '';
    nextBtn.style.display = '';
    prevBtn.onclick = function () { goTo(current - 1); startTimer(); };
    nextBtn.onclick = function () { goTo(current + 1); startTimer(); };
    dotsEl.onclick = function (e) {
      var btn = e.target.closest('.banner-dot');
      if (btn) { goTo(parseInt(btn.getAttribute('data-i'), 10)); startTimer(); }
    };
    el.addEventListener('mouseenter', function () { clearInterval(timer); });
    el.addEventListener('mouseleave', startTimer);
    startTimer();
  } else {
    dotsEl.style.display = 'none';
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
  }

  el.style.display = '';
}

(function () {
  var closeBtn = document.getElementById('bannerClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      var el = document.getElementById('siteBanner');
      if (el) el.style.display = 'none';
      sessionStorage.setItem('banner_dismissed', '1');
    });
  }
})();

function subscribeRealtime() {
  supabase.channel('catalog-products')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, function () { loadProducts(); })
    .subscribe();
  supabase.channel('catalog-config')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'store_config' }, function () { loadConfig(); })
    .subscribe();
  supabase.channel('catalog-banners')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'banners' }, function () { loadConfig(); })
    .subscribe();
  supabase.channel('catalog-categories')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, function () { loadCategories(); })
    .subscribe();
  supabase.channel('catalog-brands')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'brands' }, function () { loadBrands(); })
    .subscribe();
}

/* ============================================================
   Eventos estáticos
   ============================================================ */
function wireStaticEvents() {
  document.getElementById('searchInput').addEventListener('input', function (e) {
    state.searchTerm = e.target.value;
    renderChips();
    renderCatalog();
  });
  document.getElementById('openCartBtn').addEventListener('click', openCart);
  document.getElementById('closeCartBtn').addEventListener('click', closeCart);
  document.getElementById('cartOverlay').addEventListener('click', closeCart);
  document.getElementById('closeCheckoutModalBtn').addEventListener('click', closeCheckoutModal);
  document.getElementById('cancelCheckoutBtn').addEventListener('click', closeCheckoutModal);
  document.getElementById('confirmCheckoutBtn').addEventListener('click', confirmCheckout);
  window.addEventListener('hashchange', routeFromHash);
}

/* ============================================================
   Início
   ============================================================ */
async function init() {
  loadCartLocal();
  wireStaticEvents();
  renderCartCount();
  await Promise.all([loadProducts(), loadConfig(), loadCategories(), loadBrands()]);
  subscribeRealtime();
  await routeFromHash();
}

init();
