/* Публичные настройки демонстрации. Не добавляйте сюда API-ключи или пароли. */
window.GM_CONFIG = {
  mode: 'whatsapp',
  brand: 'GM COFFEE',
  city: 'Грозный',
  address: null,
  phone: '79280200442',
  hours: null,
  delivery: {
    enabled: true,
    fee: 149,
    freeFrom: 1000,
    minOrder: 0,
    eta: '40–60 мин',
    zones: [],
    isDemo: false
  },
  pickup: { enabled: true, eta: '15–20 мин', isDemo: false },
  catalogPageSize: 10,
  maxItemQuantity: 20,
  maxCartQuantity: 100,
  // This static demo has no payment or iiko network adapters.
  payment: { method: 'on_confirmation', connected: false },
  iiko: { connected: false }
};
