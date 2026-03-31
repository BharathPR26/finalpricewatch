// ── PriceWatch API Client v2 ──────────────────────────────────
const BASE = '';  // same origin when hosted; change to 'http://localhost:3000' for Live Server

async function apiFetch(path, options = {}) {
  const res  = await fetch(`${BASE}/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const API = {
  // Auth
  login:    (email, password)       => apiFetch('/auth/login',    { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (name, email, password) => apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
  logout:   ()                      => apiFetch('/auth/logout',   { method: 'POST' }),
  me:       ()                      => apiFetch('/auth/me'),
  setNotif: (notify_email)          => apiFetch('/auth/notifications', { method: 'PUT', body: JSON.stringify({ notify_email }) }),

  // Products
  getProducts:   ()           => apiFetch('/products'),
  getProduct:    (id)         => apiFetch(`/products/${id}`),
  addProduct:    (data)       => apiFetch('/products', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (id, data)   => apiFetch(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProduct: (id)         => apiFetch(`/products/${id}`, { method: 'DELETE' }),
  updatePrice:   (id, price)  => apiFetch(`/products/${id}/price`, { method: 'POST', body: JSON.stringify({ price }) }),

  // Watchlist
  getWatchlist:   ()                    => apiFetch('/watchlist'),
  addToWatchlist: (product_id, target)  => apiFetch('/watchlist', { method: 'POST', body: JSON.stringify({ product_id, target_price: target }) }),
  updateTarget:   (id, target)          => apiFetch(`/watchlist/${id}`, { method: 'PUT', body: JSON.stringify({ target_price: target }) }),
  removeWatch:    (id)                  => apiFetch(`/watchlist/${id}`, { method: 'DELETE' }),

  // Alerts
  getAlerts:   () => apiFetch('/alerts'),
  getStats:    () => apiFetch('/alerts/stats'),
  markAllRead: () => apiFetch('/alerts/read-all', { method: 'PUT' }),

  // Scraper
  scrapeUrl: (url) => apiFetch('/scrape', { method: 'POST', body: JSON.stringify({ url }) }),
};