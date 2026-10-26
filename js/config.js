/* Публичные настройки демонстрации. Не добавляйте сюда API-ключи или пароли. */
window.GM_CONFIG = {
  mode: 'demo',
  brand: 'GM COFFEE',
  city: null,
  address: null,
  phone: null,
  hours: null,
  delivery: {
    enabled: true,
    fee: 149,
    freeFrom: 1000,
    minOrder: 0,
    eta: '40–60 мин',
    zones: [],
    isDemo: true
  },
  pickup: { enabled: true, eta: '15–20 мин', isDemo: true },
  catalogPageSize: 8,
  maxItemQuantity: 20,
  maxCartQuantity: 100,
  // This static demo has no payment or iiko network adapters.
  payment: { method: 'sbp', connected: false },
  iiko: { connected: false }
};
