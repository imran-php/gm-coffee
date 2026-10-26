/* Pure basket functions, shared with the automated Node tests. No network access. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GM_CORE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const money = (amount) => new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: 'RUB', maximumFractionDigits: 0
  }).format(Number.isFinite(amount) ? amount : 0);
  const key = (id, variant) => `${id}:${variant}`;
  const normalize = (s) => String(s || '').toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function resolve(line, products) {
    if (!line || typeof line !== 'object') return null;
    const product = products.find((p) => p.id === line.id && p.available);
    const variant = product?.variants.find((v) => v.id === String(line.variant));
    if (!variant || !Number.isSafeInteger(variant.price) || variant.price < 0) return null;
    return { product, variant };
  }
  function sanitizeCart(input, products, maxItem = 20, maxTotal = 100) {
    if (!Array.isArray(input)) return [];
    const result = [];
    let remaining = maxTotal;
    for (const line of input.slice(0, 200)) {
      if (!resolve(line, products) || !Number.isSafeInteger(line.qty) || line.qty < 1 || remaining <= 0) continue;
      const existing = result.find((x) => key(x.id, x.variant) === key(line.id, line.variant));
      const allowed = Math.min(line.qty, maxItem - (existing?.qty || 0), remaining);
      if (allowed <= 0) continue;
      if (existing) existing.qty += allowed;
      else result.push({ id: line.id, variant: String(line.variant), qty: allowed });
      remaining -= allowed;
    }
    return result;
  }
  function totals(cart, products, config, method = 'delivery') {
    const lines = sanitizeCart(cart, products, config.maxItemQuantity, config.maxCartQuantity);
    const subtotal = lines.reduce((sum, l) => sum + resolve(l, products).variant.price * l.qty, 0);
    const delivery = subtotal && method === 'delivery' && subtotal < config.delivery.freeFrom ? config.delivery.fee : 0;
    const remaining = Math.max(0, config.delivery.freeFrom - subtotal);
    return { subtotal, delivery, total: subtotal + delivery, remaining,
      count: lines.reduce((sum, l) => sum + l.qty, 0),
      minReached: method !== 'delivery' || subtotal >= config.delivery.minOrder };
  }
  function validPhone(value) {
    const digits = String(value).replace(/\D/g, '');
    return /^[78]\d{10}$/.test(digits);
  }
  function search(products, categories, query, category = 'all', favorites = null) {
    const q = normalize(query);
    return products.filter((p) => (category === 'all' || p.category === category) &&
      (!favorites || favorites.includes(p.id)) &&
      (!q || normalize(p.name + ' ' + categories.find((c) => c.id === p.category)?.name).includes(q)));
  }
  return { money, key, normalize, escape, resolve, sanitizeCart, totals, validPhone, search };
});
