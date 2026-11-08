/* GM COFFEE — static presentation build. No real payments, no iiko requests.
 * Cart and anonymized demo order persist locally; form data stays in memory.
 */
(function () {
  'use strict';
  const C = window.GM_CORE, config = window.GM_CONFIG, menu = window.GM_MENU;
  const products = menu.products, categories = menu.categories;
  const $ = (s, parent = document) => parent.querySelector(s);
  const $$ = (s, parent = document) => [...parent.querySelectorAll(s)];
  const e = C.escape, money = C.money;
  const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const KEYS = { cart: 'gm-demo-cart-v1', favorites: 'gm-demo-favorites-v1', order: 'gm-demo-order-v1' };
  let storageAvailable = true;
  function read(key, fallback) {
    let raw;
    try { raw = localStorage.getItem(key); } catch (_) { storageAvailable = false; return fallback; }
    try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (_) { storageAvailable = false; return false; }
  }
  function remove(key) { try { localStorage.removeItem(key); } catch (_) { storageAvailable = false; } }
  let cart = C.sanitizeCart(read(KEYS.cart, []), products, config.maxItemQuantity, config.maxCartQuantity);
  let favorites = read(KEYS.favorites, []);
  favorites = Array.isArray(favorites) ? [...new Set(favorites.filter((id) => products.some((p) => p.id === id)))] : [];
  let lastOrder = read(KEYS.order, null);
  if (!lastOrder || lastOrder.mode !== 'demo' || !/^DEMO-[A-Z0-9-]+$/.test(lastOrder.id || '') || !Array.isArray(lastOrder.items) || !Number.isFinite(lastOrder.totals?.total)) lastOrder = null;
  const filter = { category: 'all', query: '', sort: 'editorial', favoritesOnly: false, limit: config.catalogPageSize };
  const selectedVariants = Object.create(null);
  let method = config.delivery.enabled ? 'delivery' : 'pickup';
  let currentModal = null, productDraft = null, checkoutDraft = {city: config.city || 'Грозный'}, pendingOrder = null;
  let paymentBusy = false, paymentTimer = null, toastTimer = null;
  const modal = $('#modal'), modalContent = $('#modal-content');
  const categoryName = (id) => categories.find((c) => c.id === id)?.name || '';
  const productById = (id) => products.find((p) => p.id === id);
  const currentVariant = (p) => p.variants.find((v) => v.id === selectedVariants[p.id]) || p.variants[0];
  const countWord = (n) => n % 10 === 1 && n % 100 !== 11 ? 'напиток' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'напитка' : 'напитков';
  const totals = () => C.totals(cart, products, config, method);
  function notify(text) {
    let el = $('#toast');
    if (modal.open) {
      el = $('.dialog-toast', modal) || document.createElement('div');
      el.className = 'dialog-toast'; el.setAttribute('role', 'status');
      if (!el.isConnected) modal.appendChild(el);
    }
    el.textContent = text; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3100);
  }
  function focusKey() { return document.activeElement?.dataset?.focus || null; }
  function restoreFocus(key) {
    if (!key) return;
    const target = $$('[data-focus]').find((el) => el.dataset.focus === key);
    if (target && !target.disabled) target.focus({ preventScroll: true });
  }
  function showModal(type, html, selector = '#modal-title') {
    $('.dialog-toast', modal)?.remove();
    currentModal = type;
    modal.className = `modal modal-${type}`;
    modalContent.innerHTML = html;
    document.body.classList.add('modal-open');
    if (!modal.open) modal.showModal();
    modal.scrollTop = 0;
    const target = $(selector, modal) || $('button', modal);
    if (target) target.focus({ preventScroll: true });
  }
  function closeModal() { if (currentModal === 'checkout') saveCheckoutDraft(); modal.close(); }
  function closeButton() { return `<button type="button" class="icon-button" data-action="close" aria-label="Закрыть окно">${icon('close')}</button>`; }
  function heading(title, eyebrow = '') { return `<div class="modal-heading"><div>${eyebrow ? `<div class="eyebrow">${e(eyebrow)}</div>` : ''}<h2 id="modal-title" tabindex="-1">${title}</h2></div>${closeButton()}</div>`; }
  function notice(text) { return `<div class="demo-notice">${icon('info')}<div>${text}</div></div>`; }
  modal.addEventListener('close', () => {
    document.body.classList.remove('modal-open');
    // Closing payment is cancellation of this demo attempt, never a success.
    if (currentModal === 'payment') { clearTimeout(paymentTimer); paymentBusy = false; pendingOrder = null; }
    currentModal = null;
  });
  modal.addEventListener('cancel', (event) => {
    if (paymentBusy) event.preventDefault();
  });
  modal.addEventListener('click', (event) => {
    const r = modal.getBoundingClientRect();
    if (event.target === modal && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) && !paymentBusy) closeModal();
  });
  function renderHeader() {
    const t = totals();
    $('#header-count').textContent = t.count;
    $('#mobile-count').textContent = t.count;
    $('#mobile-total').textContent = money(t.subtotal);
    $('#mobile-cart').hidden = t.count === 0;
    document.body.classList.toggle('has-cart', t.count > 0);
    $('.favorite-nav').setAttribute('aria-pressed', String(filter.favoritesOnly));
    const f = $('.favorite-count'); f.textContent = favorites.length; f.hidden = !favorites.length;
    $$('.cart-button').forEach((el) => el.setAttribute('aria-label', `Открыть корзину: ${t.count} ${countWord(t.count)}, ${money(t.subtotal)}`));
  }
  function renderCategories() {
    $('#categories').innerHTML = [{ id: 'all', name: 'Все напитки' }, ...categories].map((cat) => `<button type="button" class="category-tab" data-action="category" data-id="${cat.id}" data-focus="category-${cat.id}" aria-pressed="${filter.category === cat.id}">${e(cat.name)}${cat.id === 'all' ? '<span class="category-count">64</span>' : ''}</button>`).join('');
  }
  function qtyControl(id, variant, qty, scope = 'cart', max = config.maxItemQuantity) {
    const key = `${scope}-${id}-${variant}`;
    const name = productById(id)?.name || 'напитка';
    return `<div class="quantity-control" role="group" aria-label="Количество ${e(name)}"><button type="button" data-action="${scope === 'product' ? 'product-qty' : 'qty'}" data-id="${id}" data-variant="${variant}" data-delta="-1" data-focus="minus-${key}" aria-label="Уменьшить количество ${e(name)}" ${scope === 'product' && qty <= 1 ? 'disabled' : ''}>${icon('minus')}</button><span aria-live="polite">${qty}</span><button type="button" data-action="${scope === 'product' ? 'product-qty' : 'qty'}" data-id="${id}" data-variant="${variant}" data-delta="1" data-focus="plus-${key}" aria-label="Увеличить количество ${e(name)}" ${qty >= max ? 'disabled' : ''}>${icon('plus')}</button></div>`;
  }
  function sizeOptions(p, selected, scope = 'card') {
    if (p.variants.length === 1) return `<div class="size-options"><span class="single-size">Одна порция</span></div>`;
    return `<div class="size-options" role="group" aria-label="Объём ${e(p.name)}">${p.variants.map((v) => `<button type="button" class="size-button" data-action="variant" data-scope="${scope}" data-id="${p.id}" data-variant="${v.id}" data-focus="variant-${scope}-${p.id}-${v.id}" aria-pressed="${selected === v.id}">${e(v.label)}</button>`).join('')}</div>`;
  }
  function productCard(p, idx) {
    const v = currentVariant(p), line = cart.find((x) => C.key(x.id, x.variant) === C.key(p.id, v.id));
    const fav = favorites.includes(p.id);
    const badge = p.id === 'raf-02' ? 'С урбечом' : p.id === 'bubble-tea-01' ? 'Bubble time' : '';
    return `<article class="product-card" data-product-id="${p.id}"><div class="product-visual"><button type="button" class="product-open-image" data-action="product" data-id="${p.id}" aria-label="Подробнее о напитке ${e(p.name)}"><img src="${p.image}" width="400" height="300" loading="${idx < 4 ? 'eager' : 'lazy'}" alt="${e(p.name)} — фото напитка"></button>${badge ? `<span class="product-sticker">${badge}</span>` : ''}<button type="button" class="icon-button product-favorite" data-action="favorite" data-id="${p.id}" data-focus="favorite-${p.id}" aria-label="${fav ? 'Убрать из избранного' : 'В избранное'}: ${e(p.name)}" aria-pressed="${fav}">${icon('heart')}</button></div><div class="product-info"><p class="product-category">${e(categoryName(p.category))}</p><h3 class="product-title"><button type="button" data-action="product" data-id="${p.id}">${e(p.name)}</button></h3>${sizeOptions(p, v.id)}<div class="product-bottom"><strong class="product-price">${money(v.price)}</strong>${!p.available ? '<span class="unavailable-label">Сейчас нет</span>' : line ? qtyControl(p.id, v.id, line.qty, 'card') : `<button type="button" class="add-button" data-action="add" data-id="${p.id}" data-variant="${v.id}" data-focus="add-${p.id}-${v.id}" aria-label="Добавить ${e(p.name)}, ${e(v.label)}, ${money(v.price)}">${icon('plus')}</button>`}</div></div></article>`;
  }
  function renderCatalog(keepFocus = false) {
    const key = keepFocus ? focusKey() : null;
    let list = C.search(products, categories, filter.query, filter.category, filter.favoritesOnly ? favorites : null);
    if (filter.sort === 'price-asc') list.sort((a, b) => a.variants[0].price - b.variants[0].price);
    if (filter.sort === 'price-desc') list.sort((a, b) => b.variants[0].price - a.variants[0].price);
    if (filter.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const shown = list.slice(0, filter.limit);
    $('#product-grid').innerHTML = shown.length ? shown.map(productCard).join('') : `<div class="empty-state">${icon(filter.favoritesOnly ? 'heart' : 'search')}<h3>${filter.favoritesOnly && !favorites.length ? 'Здесь будет твой любимый кофе' : 'Пока ничего не нашлось'}</h3><p>${filter.favoritesOnly && !favorites.length ? 'Нажми на сердечко у напитка, чтобы сохранить его в избранное.' : 'Попробуй другое название или посмотри всё меню.'}</p><button type="button" class="button outline" data-action="reset-filters">Показать всё меню${icon('arrow')}</button></div>`;
    $('#result-count').textContent = `${filter.favoritesOnly ? 'Избранное · ' : ''}${list.length} ${countWord(list.length)}`;
    $('#catalog-progress').textContent = list.length ? `Показано ${shown.length} из ${list.length}` : '';
    $('#load-more').hidden = shown.length >= list.length;
    $('#clear-search').hidden = !filter.query;
    $('#reset-filters').hidden = !filter.query && filter.category === 'all' && !filter.favoritesOnly;
    renderHeader();
    if (keepFocus) restoreFocus(key);
  }
  function updateCart() {
    cart = C.sanitizeCart(cart, products, config.maxItemQuantity, config.maxCartQuantity);
    write(KEYS.cart, cart);
    renderCatalog(true);
    if (currentModal === 'cart') renderCart(true);
  }
  function addToCart(id, variant, amount = 1, showToast = true) {
    const resolved = C.resolve({ id, variant }, products);
    if (!resolved || !Number.isSafeInteger(amount) || amount < 1) return false;
    const line = cart.find((l) => C.key(l.id, l.variant) === C.key(id, variant));
    if ((line?.qty || 0) + amount > config.maxItemQuantity) { notify(`До ${config.maxItemQuantity} порций одного варианта`); return false; }
    if (totals().count + amount > config.maxCartQuantity) { notify(`До ${config.maxCartQuantity} напитков в заказе`); return false; }
    if (line) line.qty += amount;
    else cart.push({ id, variant: String(variant), qty: amount });
    updateCart();
    if (showToast) notify(`${resolved.product.name} · ${resolved.variant.label} — в корзине`);
    return true;
  }
  function changeQuantity(id, variant, delta) {
    const i = cart.findIndex((l) => C.key(l.id, l.variant) === C.key(id, variant));
    if (i < 0) return;
    if (delta > 0) addToCart(id, variant, 1, false);
    else { cart[i].qty--; if (cart[i].qty <= 0) cart.splice(i, 1); updateCart(); }
  }
  const mood = {
    'black-coffee': 'Для тех минут, когда хочется просто кофе. Выбери свой привычный ритуал.',
    'milk-coffee': 'Мягкая кофейная пауза между большими и маленькими делами.',
    'cold-coffee': 'Кофейное настроение в прохладном исполнении. Для смены привычного ритма.',
    raf: 'Немного нежности в твоём дне. Найди своё настроение в коллекции рафов.',
    fresh: 'Яркая пауза с фруктовым настроением. Цвета, которые хочется взять с собой.',
    lemonades: 'Когда хочется чего-то освежающего. Выбирай свой цвет и своё настроение.',
    cocktails: 'Маленькое удовольствие без особого повода. Просто потому, что сегодня хочется.',
    tea: 'Для неспешных разговоров и тёплых моментов наедине с собой.',
    'bubble-tea': 'Добавь немного bubble-настроения. Попробуй что-то за пределами привычного.'
  };
  function openProduct(id, reset = true, keepFocus = false) {
    const p = productById(id); if (!p) return;
    const key = keepFocus ? focusKey() : null;
    if (reset) productDraft = { id, variant: currentVariant(p).id, qty: 1 };
    const v = p.variants.find((x) => x.id === productDraft.variant) || p.variants[0];
    showModal('product', `<div class="product-modal-layout"><button type="button" class="icon-button modal-close" data-action="close" aria-label="Закрыть карточку">${icon('close')}</button><div class="product-modal-art"><img src="${p.image}" width="400" height="300" alt="${e(p.name)} — фото напитка"></div><div class="product-modal-details"><div class="eyebrow">${e(categoryName(p.category))}</div><h2 id="modal-title" tabindex="-1">${e(p.name)}</h2><p class="product-mood">${mood[p.category]}</p><span class="field-caption">${p.variants.length > 1 ? 'Выбери объём' : 'Размер порции'}</span>${sizeOptions(p, v.id, 'product')}<div class="quantity-row">${qtyControl(p.id, v.id, productDraft.qty, 'product')}<strong class="product-price">${money(v.price * productDraft.qty)}</strong></div><button type="button" class="button primary full" data-action="product-add" ${!p.available ? 'disabled' : ''}>${p.available ? `В корзину · ${money(v.price * productDraft.qty)}` : 'Сейчас нет в наличии'}${icon('bag')}</button><p class="product-fineprint">Состав и аллергены можно уточнить при заказе. Изображение создано для меню. Подача может отличаться.</p></div></div>`);
    if (keepFocus) restoreFocus(key);
  }
  function sumRows(t, finalLabel = 'Итого', deliveryMethod = method) {
    return `<div class="sum-row"><span>Напитки</span><strong>${money(t.subtotal)}</strong></div><div class="sum-row"><span>${deliveryMethod === 'pickup' ? 'Самовывоз' : 'Доставка'}</span><strong>${t.delivery === 0 ? 'Бесплатно' : money(t.delivery)}</strong></div><div class="sum-row total"><span>${finalLabel}</span><strong>${money(t.total)}</strong></div>`;
  }
  function renderCart(keepFocus = false) {
    const key = keepFocus ? focusKey() : null, t = totals();
    const scrollTop = keepFocus ? ($('.cart-scroll')?.scrollTop || 0) : 0;
    const content = cart.length ? `<div class="cart-scroll"><div class="delivery-progress"><p>${t.remaining > 0 ? `Ещё <strong>${money(t.remaining)}</strong> — и доставка за наш счёт` : '<strong>Доставка за наш счёт</strong>'}</p><progress max="${config.delivery.freeFrom}" value="${Math.min(t.subtotal, config.delivery.freeFrom)}" aria-label="До бесплатной доставки"></progress><small>Бесплатная доставка от ${money(config.delivery.freeFrom)}</small></div>${cart.map((l) => {
      const { product: p, variant: v } = C.resolve(l, products);
      return `<article class="cart-item"><img class="cart-thumb" src="${p.image}" width="70" height="84" alt=""><div><div class="cart-item-top"><div><h3>${e(p.name)}</h3><small>${e(v.label)} · ${money(v.price)} за порцию</small></div><button type="button" class="remove-item" data-action="remove" data-id="${p.id}" data-variant="${v.id}" aria-label="Удалить ${e(p.name)}">${icon('close')}</button></div><div class="cart-item-bottom">${qtyControl(p.id, v.id, l.qty)}<strong>${money(l.qty * v.price)}</strong></div></div></article>`;
    }).join('')}<button type="button" class="cart-clear" data-action="clear-cart">Очистить корзину</button></div><div class="cart-footer">${sumRows(t)}<button type="button" class="button primary full" data-action="checkout" ${!t.minReached ? 'disabled' : ''}>Оформить заказ${icon('arrow')}</button><p>${!t.minReached ? `Минимальная сумма напитков для доставки — ${money(config.delivery.minOrder)}. ` : ''}Без регистрации. Подтвердим заказ в WhatsApp.</p></div>` : `<div class="cart-empty">${icon('bag')}<h3>Самое вкусное<br>ещё впереди.</h3><p>Добавь в корзину любимый напиток.<br>Пусть эта пауза будет твоей.</p><button type="button" class="button primary" data-action="to-menu">Перейти к меню${icon('arrow')}</button></div>`;
    showModal('cart', `<div class="cart-layout">${heading(`Корзина <span class="title-count">${t.count}</span>`)}${content}</div>`);
    if (keepFocus) { const scroll = $('.cart-scroll'); if (scroll) scroll.scrollTop = scrollTop; restoreFocus(key); }
  }
  function saveCheckoutDraft() {
    const form = $('#checkout-form');
    if (form) {
      checkoutDraft = { ...checkoutDraft, ...Object.fromEntries(new FormData(form)) };
      checkoutDraft.testAgreement = form.elements.namedItem('testAgreement').checked ? 'on' : '';
    }
  }
  function input(name, title, placeholder, { type = 'text', wide = false, max = 80, required = true, autocomplete = 'off' } = {}) {
    return `<label class="form-label ${wide ? 'wide' : ''}">${e(title)}${required ? ' <span aria-hidden="true">*</span>' : ''}<input name="${name}" type="${type}" value="${e(checkoutDraft[name] || '')}" placeholder="${e(placeholder)}" maxlength="${max}" autocomplete="${autocomplete}" ${required ? 'required' : ''} ${type === 'tel' ? 'inputmode="tel"' : ''} aria-describedby="error-${name}"><span id="error-${name}" class="form-error" hidden></span></label>`;
  }
  function renderCheckout() {
    if (!cart.length) { renderCart(); return; }
    const t = totals();
    const isDelivery = method === 'delivery';
    const methods = (config.delivery.enabled ? `<button type="button" data-action="method" data-method="delivery" aria-pressed="${isDelivery}">${icon('truck')}Доставка</button>` : '') + (config.pickup.enabled ? `<button type="button" data-action="method" data-method="pickup" aria-pressed="${!isDelivery}">${icon('cup')}Самовывоз</button>` : '');
    const address = isDelivery ? `<fieldset><legend><span class="step-number">03</span> Куда привезти?</legend><div class="field-grid">${input('city','Город','Грозный',{wide:true})}${input('street','Улица','Например, Кофейная',{wide:true})}${input('house','Дом','1',{max:12})}${input('apartment','Квартира / офис','Необязательно',{max:12,required:false})}</div><p class="method-note">Возможность доставки по адресу подтвердим в WhatsApp.</p></fieldset>` : `<fieldset><legend><span class="step-number">03</span> Где забрать?</legend><div class="location-note">${icon('pin')}<p>${config.address ? e(config.address) : 'Место и время самовывоза согласуем в WhatsApp.'}</p></div></fieldset>`;
    const orderItems = cart.map((l) => {
      const { product: p, variant: v } = C.resolve(l, products);
      return `<div class="checkout-item"><img src="${p.image}" width="43" height="49" alt=""><div><h4>${e(p.name)}</h4><p>${e(v.label)} × ${l.qty}</p></div><strong>${money(v.price * l.qty)}</strong></div>`;
    }).join('');
    showModal('checkout', `${heading('Оформление заказа')}<div class="checkout-layout"><form id="checkout-form" class="checkout-form" novalidate><fieldset><legend><span class="step-number">01</span> Как получить заказ?</legend><div class="method-switch" role="group" aria-label="Способ получения">${methods}</div><p class="method-note">${isDelivery ? `${e(config.delivery.eta)} · Доставка` : `${e(config.pickup.eta)} · Забрать в кофейне`}</p></fieldset><fieldset><legend><span class="step-number">02</span> Как к тебе обращаться?</legend><div class="field-grid">${input('name','Имя','Твоё имя',{max:60,autocomplete:'given-name'})}${input('phone','Телефон','+7 (928) 000-00-00',{type:'tel',max:22,autocomplete:'tel'})}</div></fieldset>${address}<fieldset><legend><span class="step-number">04</span> Пожелания к заказу</legend><div class="field-grid"><label class="form-label wide">Время получения<select name="time"><option value="soon" ${checkoutDraft.time === 'soon' ? 'selected' : ''}>Как можно скорее</option><option value="hour" ${checkoutDraft.time === 'hour' ? 'selected' : ''}>Примерно через час</option><option value="two-hours" ${checkoutDraft.time === 'two-hours' ? 'selected' : ''}>Примерно через 2 часа</option></select></label><label class="form-label wide">Комментарий<textarea name="comment" maxlength="300" placeholder="Например: без сахара, позвонить у входа">${e(checkoutDraft.comment || '')}</textarea></label></div></fieldset><label class="test-consent"><input type="checkbox" name="testAgreement" ${checkoutDraft.testAgreement ? 'checked' : ''} aria-describedby="error-agreement"><span>Согласен передать имя, телефон, адрес и состав заказа кофейне через WhatsApp для оформления заказа.</span></label><span class="form-error" id="error-agreement" hidden></span><button class="button primary full checkout-submit" type="submit">Заказать в WhatsApp · ${money(t.total)}${icon('arrow')}</button><p class="method-note">Откроется WhatsApp с готовым сообщением. Нажми «Отправить», чтобы передать заказ. Оплату и время подтвердим в переписке.</p><button type="button" class="text-button" data-action="back-cart">Вернуться в корзину</button></form><aside class="checkout-summary"><div class="checkout-summary-inner"><h3>Твоя кофейная пауза</h3><div class="checkout-items">${orderItems}</div>${sumRows(t)}${notice('Заказ подтвердим в WhatsApp. Оплата — по согласованию с кофейней.')}<p class="checkout-privacy">Корзина сохраняется в этом браузере. Имя, телефон, адрес и комментарий остаются только в памяти открытой страницы и не сохраняются в историю заказа.</p></div></aside></div>`);
  }
  function validationError(form, name, text) {
    const input = form.elements.namedItem(name);
    input?.setAttribute('aria-invalid', 'true');
    const output = $(`#error-${name === 'testAgreement' ? 'agreement' : name}`);
    if (output) { output.textContent = text; output.hidden = false; }
    return input;
  }
  function validateCheckout(form) {
    $$('[aria-invalid]', form).forEach((x) => x.removeAttribute('aria-invalid'));
    $$('.form-error', form).forEach((x) => { x.hidden = true; });
    let first = null;
    const error = (name, text) => { const input = validationError(form, name, text); if (!first) first = input; };
    if (String(checkoutDraft.name || '').trim().length < 2) error('name', 'Укажи имя: минимум 2 символа.');
    if (!C.validPhone(checkoutDraft.phone || '')) error('phone', 'Нужен номер из 11 цифр, начиная с +7 или 8.');
    if (method === 'delivery') {
      if (String(checkoutDraft.city || '').trim().length < 2) error('city', 'Укажи город.');
      if (String(checkoutDraft.street || '').trim().length < 2) error('street', 'Укажи улицу.');
      if (!String(checkoutDraft.house || '').trim()) error('house', 'Укажи номер дома.');
    }
    if (!checkoutDraft.testAgreement) error('testAgreement', 'Подтверди передачу данных для заказа.');
    if (first) { first.focus(); first.scrollIntoView({ block: 'center', behavior: 'smooth' }); return false; }
    return true;
  }
  function sendWhatsAppOrder() {
    const t = totals();
    const time = {soon:'Как можно скорее',hour:'Примерно через час','two-hours':'Примерно через 2 часа'};
    const lines = cart.map(l => { const {product:p,variant:v} = C.resolve(l, products); return `• ${p.name} (${v.label}) × ${l.qty} — ${money(v.price*l.qty)}`; });
    const text = ['Заказ GM COFFEE', '', ...lines, '', `Напитки: ${money(t.subtotal)}`, `${method === 'pickup' ? 'Самовывоз' : 'Доставка'}: ${money(t.delivery)}`, `Итого: ${money(t.total)}`, '', `Имя: ${checkoutDraft.name.trim()}`, `Телефон: ${checkoutDraft.phone}`, `Получение: ${method === 'pickup' ? 'Самовывоз' : 'Доставка'}`, ...(method === 'delivery' ? [`Адрес: ${checkoutDraft.city}, ${checkoutDraft.street}, д. ${checkoutDraft.house}${checkoutDraft.apartment ? ', кв./офис ' + checkoutDraft.apartment : ''}`] : []), `Время: ${time[checkoutDraft.time] || time.soon}`, ...(checkoutDraft.comment ? [`Комментарий: ${checkoutDraft.comment}`] : [])].join('\n');
    const url = `https://wa.me/79280200442?text=${encodeURIComponent(text)}`;
    showModal('info', `${heading('Отправь заказ в WhatsApp')}<div class="info-body"><p>Сообщение готово. Открой WhatsApp и нажми «Отправить». Мы подтвердим состав, время и оплату в переписке.</p><a class="button primary full" href="${e(url)}" target="_blank" rel="noopener noreferrer">Открыть WhatsApp${icon('arrow')}</a><button type="button" class="text-button" data-action="checkout">Вернуться к оформлению</button></div>`);
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
  }
  function showDemoInfo() {
    showModal('info', `${heading('Заказ в GM COFFEE')}<div class="info-body"><p>Выбери напитки, заполни контакты и адрес. Нажми «Заказать в WhatsApp», затем отправь готовое сообщение. Подтверждение заказа, время и оплату согласуем в переписке.</p><a class="button primary full" href="https://wa.me/79280200442" target="_blank" rel="noopener noreferrer">Написать в WhatsApp</a></div>`);
  }
  function showPrivacy() {
    showModal('info', `${heading('Данные и приватность')}<div class="info-body"><p>Корзина и избранное сохраняются в этом браузере. Контакты и адрес остаются в памяти страницы до обновления и включаются в сообщение WhatsApp при оформлении.</p><p>После перехода в WhatsApp сообщение передаётся сервису WhatsApp. Отправь его кофейне, чтобы оформить заказ.</p></div>`);
  }
  function resetFilters() {
    Object.assign(filter, { category: 'all', query: '', favoritesOnly: false, sort: 'editorial', limit: config.catalogPageSize });
    $('#search').value = ''; $('#sort').value = 'editorial'; renderCategories(); renderCatalog();
  }
  function jumpToCatalog() { $('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function handleAction(button) {
    const action = button.dataset.action, id = button.dataset.id, variant = button.dataset.variant;
    switch (action) {
      case 'close': if (!paymentBusy) closeModal(); break;
      case 'cart': renderCart(); break;
      case 'category': { const key = focusKey(); filter.category = id; filter.limit = config.catalogPageSize; renderCategories(); renderCatalog(); restoreFocus(key); break; }
      case 'category-jump': filter.category = button.dataset.category; filter.query = ''; filter.favoritesOnly = false; filter.limit = config.catalogPageSize; $('#search').value = ''; renderCategories(); renderCatalog(); jumpToCatalog(); break;
      case 'reset-filters': resetFilters(); break;
      case 'clear-search': filter.query = ''; $('#search').value = ''; filter.limit = config.catalogPageSize; renderCatalog(); $('#search').focus(); break;
      case 'load-more': { const count = $$('.product-card').length; filter.limit += config.catalogPageSize; renderCatalog(); const firstNew = $$('.product-open-image')[count]; firstNew?.focus({ preventScroll: true }); break; }
      case 'favorites': filter.favoritesOnly = !filter.favoritesOnly; filter.category = 'all'; filter.query = ''; filter.limit = config.catalogPageSize; $('#search').value = ''; renderCategories(); renderCatalog(); jumpToCatalog(); break;
      case 'favorite': { const idx = favorites.indexOf(id); if (idx >= 0) favorites.splice(idx,1); else favorites.push(id); write(KEYS.favorites, favorites); renderCatalog(true); break; }
      case 'product': openProduct(id); break;
      case 'variant': if (button.dataset.scope === 'product') { productDraft.variant = variant; openProduct(id, false, true); } else { selectedVariants[id] = variant; renderCatalog(true); } break;
      case 'add': if (addToCart(id, variant)) restoreFocus(`plus-card-${id}-${variant}`); break;
      case 'qty': changeQuantity(id, variant, Number(button.dataset.delta)); break;
      case 'remove': cart = cart.filter((x) => C.key(x.id, x.variant) !== C.key(id, variant)); updateCart(); break;
      case 'product-qty': productDraft.qty = Math.max(1, Math.min(config.maxItemQuantity, productDraft.qty + Number(button.dataset.delta))); openProduct(productDraft.id, false, true); break;
      case 'product-add': if (addToCart(productDraft.id, productDraft.variant, productDraft.qty, false)) { closeModal(); notify('Напиток добавлен в корзину'); } break;
      case 'to-menu': closeModal(); jumpToCatalog(); break;
      case 'checkout': renderCheckout(); break;
      case 'back-cart': saveCheckoutDraft(); renderCart(); break;
      case 'method': saveCheckoutDraft(); method = button.dataset.method; renderCheckout(); break;
      case 'demo-info': showDemoInfo(); break;
      case 'privacy': showPrivacy(); break;
      case 'clear-cart': showModal('info', `${heading('Очистить корзину?')}<div class="info-body"><p>Все напитки будут удалены из текущей корзины. Избранное останется.</p><button type="button" class="button primary full" data-action="confirm-clear-cart">Да, очистить корзину</button><button type="button" class="button outline full" data-action="cart">Оставить напитки</button></div>`); break;
      case 'confirm-clear-cart': cart = []; updateCart(); renderCart(); break;
      case 'navigation': showModal('info', `${heading('GM COFFEE')}<nav class="navigation-links" aria-label="Навигация по сайту"><a href="#catalog">Меню</a><a href="#delivery">Доставка</a><a href="#about">О кофейне</a><button type="button" class="text-link" data-action="demo-info">Как заказать${icon('arrow')}</button></nav>`); break;
    }
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button && !button.disabled) { event.preventDefault(); handleAction(button); }
    const link = event.target.closest('.navigation-links a');
    if (link) closeModal();
  });
  $('#search').addEventListener('input', (event) => { filter.query = event.target.value; filter.limit = config.catalogPageSize; renderCatalog(); });
  $('#sort').addEventListener('change', (event) => { filter.sort = event.target.value; filter.limit = config.catalogPageSize; renderCatalog(); });
  modal.addEventListener('input', (event) => {
    if (event.target.form?.id !== 'checkout-form') return;
    const field = event.target; field.removeAttribute('aria-invalid');
    const err = $(`#error-${field.name === 'testAgreement' ? 'agreement' : field.name}`);
    if (err) err.hidden = true;
  });
  document.addEventListener('submit', (event) => {
    if (event.target.id !== 'checkout-form') return;
    event.preventDefault();
    saveCheckoutDraft();
    if (!validateCheckout(event.target)) return;
    const t = totals();
    if (!cart.length || !t.minReached) { renderCart(); return; }
    sendWhatsAppOrder();
  });
  // Keep separate tabs in sync without ever sharing form fields.
  window.addEventListener('storage', (event) => {
    if (event.key === KEYS.cart) {
      cart = C.sanitizeCart(read(KEYS.cart, []), products, config.maxItemQuantity, config.maxCartQuantity);
      renderCatalog();
      if (currentModal === 'cart') renderCart();
      if (currentModal === 'checkout') { saveCheckoutDraft(); renderCheckout(); }
      if (currentModal === 'payment') { clearTimeout(paymentTimer); paymentBusy = false; pendingOrder = null; renderCart(); notify('Корзина изменена в другой вкладке. Проверь заказ заново.'); }
    }
    if (event.key === KEYS.favorites) { const data = read(KEYS.favorites, []); favorites = Array.isArray(data) ? data.filter((id) => products.some((p) => p.id === id)) : []; renderCatalog(); }
  });
  $('#delivery-terms').textContent = `Доставка — ${money(config.delivery.fee)}. От ${money(config.delivery.freeFrom)} — бесплатно. Стоимость видна в корзине до оформления.`;
  $('#delivery-eta').textContent = `Ориентир — ${config.delivery.eta}. Точное время подтвердим в WhatsApp.`;
  renderCategories(); renderCatalog();
  if (!storageAvailable) notify('Сохранение в браузере недоступно. Корзина работает до закрытия страницы.');
})();
