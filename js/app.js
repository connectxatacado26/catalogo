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
   Sessão do cliente
   ============================================================ */
function getSession() {
  try { return JSON.parse(localStorage.getItem('cx_client_session') || 'null'); } catch(e) { return null; }
}
function setSession(data) {
  try { localStorage.setItem('cx_client_session', JSON.stringify(data)); } catch(e) {}
}
function clearSession() {
  try { localStorage.removeItem('cx_client_session'); } catch(e) {}
}
function isLoggedIn() { var s = getSession(); return !!(s && s.authed); }

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
  var showPrice = isLoggedIn();
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
          : '<div class="price-login-msg">🔒 Entre para ver os preços</div>'
        ) +
        '<button type="button" class="btn-cart' + (inCart ? ' in-cart' : '') + '" data-add="' + p.id + '">' +
          (inCart ? '✓ No carrinho (' + qty + ')' : 'Adicionar ao carrinho') +
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
  if (!isLoggedIn()) { openLoginPopup(id); return; }
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
          '</div>' +
          '<button type="button" class="remove-link" data-remove="' + it.id + '">remover</button>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  var nudgeHtml = '';
  if (state._nudge && !state.cart[state._nudge.id]) {
    nudgeHtml = '<div class="nudge"><span>Aproveite e leve <strong>' + escapeHtml(state._nudge.name) + '</strong> também.</span><button type="button" class="btn btn-sm" id="nudgeAddBtn">Adicionar</button></div>';
  }
  foot.innerHTML = nudgeHtml +
    '<div style="font-size:12px;color:var(--ink-soft);padding:6px 0 4px;">Os preços serão informados pela nossa equipe após análise do pedido.</div>' +
    '<button type="button" class="btn btn-accent" id="goCheckoutBtn" style="justify-content:center;">📲 Envie seu Pedido</button>';

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
  body.innerHTML =
    '<div class="eyebrow">Quase lá! Preencha seus dados:</div>' +
    '<div class="field"><label>Seu nome *</label><input type="text" id="co_customer" placeholder="Ex: João Silva"><div class="required-note" id="co_nameError" style="display:none;">Informe seu nome</div></div>' +
    '<div class="field"><label>Seu WhatsApp *</label><input type="tel" id="co_phone" placeholder="(11) 99999-9999"></div>' +
    '<div class="field"><label>Observações (opcional)</label><textarea id="co_notes" placeholder="Cor, urgência, combinação de itens..."></textarea></div>' +
    '<div style="border-top:1px solid var(--line);padding-top:12px;">' +
      items.map(function (it) {
        return '<div style="font-size:13px;padding:3px 0;">• ' + it.qty + 'x ' + escapeHtml(it.name) + '</div>';
      }).join('') +
      '<div style="font-size:11px;color:var(--ink-soft);margin-top:8px;">Os preços serão informados pela nossa equipe após análise do pedido.</div>' +
    '</div>' +
    (state.config.whatsapp_number ? '' : '<div class="required-note">A equipe Connect X ainda não configurou o WhatsApp de recebimento — o pedido será apenas registrado.</div>');
  document.getElementById('checkoutModalOverlay').classList.add('open');
}
function closeCheckoutModal() {
  document.getElementById('checkoutModalOverlay').classList.remove('open');
  // Restaura o rodapé ao estado original (necessário se pedido anterior o alterou)
  var foot = document.querySelector('#checkoutModalOverlay .modal-foot');
  if (foot && !document.getElementById('confirmCheckoutBtn')) {
    foot.innerHTML =
      '<button class="btn btn-ghost" id="cancelCheckoutBtn" type="button">Voltar</button>' +
      '<button class="btn btn-accent" id="confirmCheckoutBtn" type="button">📲 Envie seu Pedido</button>';
  }
}

async function _checkCustomerInTiny(phone) {
  try {
    var cfg = window.CONNECTX_CONFIG || {};
    var url = cfg.SUPABASE_URL + '/functions/v1/check-customer';
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': cfg.SUPABASE_ANON_KEY },
      body: JSON.stringify({ phone: phone.replace(/\D/g, '') }),
      signal: AbortSignal.timeout(10000)
    });
    var data = await res.json();
    return !!data.found;
  } catch (_e) {
    return true; // em caso de erro, não bloqueia
  }
}

function _openOrderPdf(order, customerFound) {
  // Agrupa itens por categoria usando state.products como referência
  var byCategory = {};
  order.items.forEach(function (it) {
    var prod = state.products.filter(function (p) { return p.code === it.code || p.name === it.name; })[0];
    var cat = (prod && prod.category) || 'Outros';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(it);
  });

  var dateStr = new Date(order.created_at).toLocaleString('pt-BR');
  var catOrder = Object.keys(byCategory).sort(function(a,b){ return a === 'Outlet' ? 1 : b === 'Outlet' ? -1 : a.localeCompare(b, 'pt-BR'); });

  var categoriesHtml = catOrder.map(function (cat) {
    var rows = byCategory[cat].map(function (it) {
      return '<tr><td style="padding:5px 16px 5px 0;color:#6b7280;font-size:13px;white-space:nowrap;">' + it.qty + 'x</td>' +
             '<td style="padding:5px 0;font-size:14px;">' + it.name + (it.code ? ' <span style="color:#9ca3af;font-size:11px;">(' + it.code + ')</span>' : '') + '</td></tr>';
    }).join('');
    return '<tr><td colspan="2" style="padding:14px 0 5px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6366f1;border-bottom:1px solid #e5e7eb;">' + cat + '</td></tr>' + rows;
  }).join('');

  var notesHtml = order.notes
    ? '<div style="margin-top:18px;padding:12px 16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;font-size:13px;color:#374151;"><strong>Observações:</strong> ' + order.notes + '</div>'
    : '';

  var regSection = '';
  if (!customerFound && order.customer_phone && state.config.whatsapp_number) {
    var regUrl = 'https://wa.me/' + state.config.whatsapp_number + '?text=' + encodeURIComponent('Olá! Gostaria de me cadastrar como cliente Connect X Atacado. Meu nome é ' + order.customer_name + ' e meu WhatsApp é ' + order.customer_phone + '.');
    regSection = '<div style="margin-top:24px;padding:16px 20px;background:#fffbeb;border:1px solid #f59e0b;border-radius:10px;font-size:13px;color:#92400e;">' +
      '<strong>👋 Você ainda não é nosso cliente cadastrado!</strong><br>' +
      'Enquanto nossa equipe analisa seu pedido, preencha nossa ficha para receber ofertas exclusivas.<br><br>' +
      '<a href="' + regUrl + '" target="_blank" style="display:inline-block;background:#f59e0b;color:#fff;padding:8px 18px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none;">📋 Preencher ficha agora</a>' +
    '</div>';
  }

  var wppNum = state.config.whatsapp_number
    ? state.config.whatsapp_number.replace(/^55/, '').replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
    : '';

  var html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<title>Pedido Connect X Atacado</title>' +
    '<style>' +
      'body{font-family:Arial,sans-serif;margin:0;padding:32px 40px;color:#111827;max-width:680px;margin:0 auto;}' +
      'h1{font-size:22px;margin:0 0 2px;}' +
      '@media print{.no-print{display:none!important;} body{padding:16px;}}' +
    '</style></head><body>' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111827;padding-bottom:16px;margin-bottom:20px;">' +
      '<div><h1>Connect X Atacado</h1><div style="font-size:12px;color:#6b7280;">Pedido · ' + dateStr + '</div></div>' +
      '<div style="text-align:right;font-size:12px;color:#6b7280;">Cód. pedido<br><strong style="font-size:14px;color:#111827;">' + order.id.slice(0,8).toUpperCase() + '</strong></div>' +
    '</div>' +
    '<div style="background:#f3f4f6;border-radius:10px;padding:14px 18px;margin-bottom:24px;">' +
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;margin-bottom:6px;">Cliente</div>' +
      '<div style="font-size:16px;font-weight:700;">' + order.customer_name + '</div>' +
      (order.customer_phone ? '<div style="font-size:14px;color:#374151;margin-top:3px;">📱 ' + order.customer_phone + '</div>' : '') +
    '</div>' +
    '<table style="width:100%;border-collapse:collapse;">' + categoriesHtml + '</table>' +
    notesHtml +
    '<div style="margin-top:24px;padding:12px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#6b7280;">' +
      'Os preços serão informados pela equipe Connect X Atacado após análise do pedido.' +
    '</div>' +
    regSection +
    (wppNum ? '<div class="no-print" style="margin-top:28px;padding:16px 20px;background:#dcfce7;border-radius:10px;font-size:14px;color:#166534;">' +
      '<strong>📤 Envie este PDF no WhatsApp:</strong> ' + wppNum +
      '<br><span style="font-size:12px;color:#4ade80;">Salve como PDF usando Ctrl+P → Imprimir → Salvar como PDF</span>' +
    '</div>' : '') +
    '</body></html>';

  var w = window.open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
    setTimeout(function () { w.focus(); w.print(); }, 600);
  }
}

async function _createOrderAndRedirect(customer, phone, notes, items, customerFound) {
  var total = items.reduce(function (sum, it) { return sum + it.price * it.qty; }, 0);
  var confirmBtn = document.getElementById('confirmCheckoutBtn');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Gerando pedido…';
  try {
    var res = await supabase.from('orders').insert([{
      customer_name: customer,
      customer_phone: phone,
      notes: notes,
      items: items.map(function (it) { return { name: it.name, code: it.code, brand: it.brand, price: it.price, qty: it.qty }; }),
      total: total
    }]).select().single();
    if (res.error) throw res.error;
    var order = res.data;
    state.cart = {};
    saveCartLocal();
    closeCart();
    renderCartCount();
    renderCatalog();

    var wppNum = state.config.whatsapp_number || '';
    var regUrl = (!customerFound && phone)
      ? 'cadastro.html?nome=' + encodeURIComponent(customer) + '&celular=' + encodeURIComponent(phone)
      : null;

    // Monta mensagem formatada do pedido para WhatsApp
    var orderWppUrl = null;
    if (wppNum) {
      var now = new Date();
      var dateStr = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      var itensMsg = items.map(function (it) {
        return '  • ' + it.qty + 'x ' + it.name + (it.code ? ' (' + it.code + ')' : '');
      }).join('\n');
      var msg =
        '📦 *PEDIDO - CONNECT X ATACADO*\n' +
        '━━━━━━━━━━━━━━━━━━━\n' +
        '👤 *Cliente:* ' + customer + '\n' +
        (phone ? '📱 *WhatsApp:* ' + phone + '\n' : '') +
        '🗓️ *Data:* ' + dateStr + '\n' +
        '━━━━━━━━━━━━━━━━━━━\n' +
        '🛒 *ITENS DO PEDIDO:*\n' +
        itensMsg + '\n' +
        '━━━━━━━━━━━━━━━━━━━\n' +
        (notes ? '📝 *Observações:* ' + notes + '\n' : '') +
        '_Preços e disponibilidade serão confirmados pela nossa equipe._';
      orderWppUrl = 'https://wa.me/' + wppNum + '?text=' + encodeURIComponent(msg);
    }

    document.getElementById('checkoutModalBody').innerHTML =
      '<div style="text-align:center;padding:12px 0 8px;">' +
        '<div style="font-size:44px;margin-bottom:10px;">✅</div>' +
        '<h3 style="margin:0 0 8px;font-family:\'Fraunces\',serif;color:var(--ink);">Pedido recebido!</h3>' +
        '<p style="font-size:14px;color:var(--ink-soft);margin:0 0 12px;line-height:1.5;">' +
          'Seu pedido foi registrado. Clique abaixo para enviá-lo pelo WhatsApp e nossa equipe confirmará em breve.' +
        '</p>' +
        (orderWppUrl
          ? '<a href="' + orderWppUrl + '" target="_blank" rel="noopener" ' +
            'style="display:inline-flex;align-items:center;gap:8px;background:#25d366;color:#fff;padding:12px 24px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;margin-bottom:16px;">' +
            '📲 Enviar pedido pelo WhatsApp</a>'
          : '') +
        (!customerFound && phone && regUrl
          ? '<div style="margin-top:16px;padding:14px;background:#fffbeb;border:1px solid #f59e0b;border-radius:10px;font-size:13px;color:#92400e;text-align:left;">' +
              '<strong>Falta só uma coisinha! 😊</strong><br><br>' +
              'Identificamos que você ainda não possui cadastro conosco. Enquanto nossa equipe analisa seu pedido, preencha sua ficha rapidinho e fique por dentro de ofertas e condições exclusivas.' +
              '<br><br><a href="' + regUrl + '" target="_blank" rel="noopener" ' +
              'style="display:inline-block;background:#f59e0b;color:#fff;padding:8px 18px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none;">👉 Complete seu cadastro agora!</a>' +
            '</div>'
          : '') +
      '</div>';

    var foot = document.querySelector('#checkoutModalOverlay .modal-foot');
    if (foot) {
      foot.innerHTML = '<button class="btn btn-ghost" id="closeCheckoutFinalBtn" type="button">Fechar</button>';
    }
  } catch (err) {
    toast(friendlyError(err));
    confirmBtn.disabled = false;
    confirmBtn.textContent = '📲 Envie seu Pedido';
  }
}

async function confirmCheckout() {
  var confirmBtn = document.getElementById('confirmCheckoutBtn');
  if (confirmBtn && confirmBtn.disabled) return; // evita duplo clique
  try {
    var items = cartItems();
    if (!items.length) { toast('Seu carrinho está vazio.'); return; }
    var customer = document.getElementById('co_customer').value.trim();
    if (!customer) {
      document.getElementById('co_nameError').style.display = 'block';
      document.getElementById('co_customer').focus();
      return;
    }
    var phone = document.getElementById('co_phone').value.trim();
    var notes = document.getElementById('co_notes').value.trim();

    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Aguarde…'; }

    var customerFound = true;
    if (phone) {
      if (confirmBtn) confirmBtn.textContent = 'Verificando cadastro…';
      customerFound = await _checkCustomerInTiny(phone);
    }

    await _createOrderAndRedirect(customer, phone, notes, items, customerFound);
  } catch (err) {
    toast(friendlyError(err) || 'Erro inesperado. Tente novamente.');
    var btn = document.getElementById('confirmCheckoutBtn');
    if (btn) { btn.disabled = false; btn.textContent = '📲 Envie seu Pedido'; }
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
   Login popup (clientes)
   ============================================================ */
var _loginPendingId = null;

function openLoginPopup(pendingProductId) {
  _loginPendingId = pendingProductId || null;
  var overlay = document.getElementById('loginModalOverlay');
  if (!overlay) return;
  document.getElementById('loginEmailInput').value = '';
  document.getElementById('loginEmailError').textContent = '';
  overlay.classList.add('open');
  setTimeout(function() { document.getElementById('loginEmailInput').focus(); }, 80);
}
function closeLoginPopup() {
  var overlay = document.getElementById('loginModalOverlay');
  if (overlay) overlay.classList.remove('open');
  _loginPendingId = null;
}
async function doClientLogin() {
  var emailEl = document.getElementById('loginEmailInput');
  var errEl   = document.getElementById('loginEmailError');
  var loginBtn = document.getElementById('loginEmailBtn');
  var email = emailEl ? emailEl.value.trim() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEl.textContent = 'Informe um e-mail válido.';
    return;
  }
  loginBtn.disabled = true;
  loginBtn.textContent = 'Verificando…';
  errEl.textContent = '';
  try {
    var cfg = window.CONNECTX_CONFIG || {};
    var res = await fetch(cfg.SUPABASE_URL + '/functions/v1/client-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': cfg.SUPABASE_ANON_KEY },
      body: JSON.stringify({ email: email }),
      signal: AbortSignal.timeout(12000),
    });
    var data = await res.json();
    if (data.found) {
      setSession({ email: email, nome: data.nome || '', cpf_cnpj: data.cpf_cnpj || '', authed: true });
      renderLoginState();
      renderCatalog();
      var firstName = (data.nome || 'Cliente').split(' ')[0];
      toast('Bem-vindo(a), ' + firstName + '! 🎉');
      var pid = _loginPendingId;
      closeLoginPopup();
      if (pid) addToCart(pid, 1);
    } else {
      errEl.textContent = 'E-mail não encontrado. Verifique ou cadastre-se.';
    }
  } catch(e) {
    errEl.textContent = 'Erro ao verificar. Tente novamente.';
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Entrar';
  }
}
function renderLoginState() {
  var btn = document.getElementById('loginStateBtn');
  if (!btn) return;
  var session = getSession();
  if (session && session.authed) {
    var firstName = (session.nome || 'Cliente').split(' ')[0];
    btn.textContent = '👤 ' + firstName;
    btn.title = 'Clique para sair';
    btn.style.background = 'rgba(99,102,241,.14)';
    btn.style.color = 'var(--accent)';
    btn.style.borderColor = 'transparent';
  } else {
    btn.textContent = 'Entrar';
    btn.title = '';
    btn.style.background = '';
    btn.style.color = '';
    btn.style.borderColor = '';
  }
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
  // Delegação no overlay — sobrevive a rewrites de innerHTML no modal-foot
  document.getElementById('checkoutModalOverlay').addEventListener('click', function (e) {
    var id = e.target.id || (e.target.closest && e.target.closest('[id]') && e.target.closest('[id]').id) || '';
    if (id === 'closeCheckoutModalBtn' || id === 'cancelCheckoutBtn' || id === 'closeCheckoutFinalBtn') {
      closeCheckoutModal();
    } else if (id === 'confirmCheckoutBtn') {
      confirmCheckout();
    }
  });
  window.addEventListener('hashchange', routeFromHash);

  // Login modal
  var loginOverlay = document.getElementById('loginModalOverlay');
  if (loginOverlay) {
    document.getElementById('closeLoginModalBtn').addEventListener('click', closeLoginPopup);
    loginOverlay.addEventListener('click', function(e) { if (e.target === loginOverlay) closeLoginPopup(); });
    document.getElementById('loginEmailBtn').addEventListener('click', doClientLogin);
    document.getElementById('loginEmailInput').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') doClientLogin();
    });
  }
  var loginStateBtn = document.getElementById('loginStateBtn');
  if (loginStateBtn) {
    loginStateBtn.addEventListener('click', function() {
      if (isLoggedIn()) {
        clearSession();
        renderLoginState();
        renderCatalog();
        toast('Você saiu da sua conta.');
      } else {
        openLoginPopup(null);
      }
    });
  }
}

/* ============================================================
   Início
   ============================================================ */
async function init() {
  loadCartLocal();
  wireStaticEvents();
  renderCartCount();
  renderLoginState();
  await Promise.all([loadProducts(), loadConfig(), loadCategories(), loadBrands()]);
  subscribeRealtime();
  await routeFromHash();
}

init();
