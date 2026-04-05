// ── PriceWatch API Client ─────────────────────────────────────
const BASE = '';

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
  login:    (email, pw)        => apiFetch('/auth/login',    { method:'POST', body:JSON.stringify({email,password:pw}) }),
  register: (name, email, pw)  => apiFetch('/auth/register', { method:'POST', body:JSON.stringify({name,email,password:pw}) }),
  logout:   ()                 => apiFetch('/auth/logout',   { method:'POST' }),
  me:       ()                 => apiFetch('/auth/me'),
  setNotif: (v)                => apiFetch('/auth/notifications', { method:'PUT', body:JSON.stringify({notify_email:v}) }),

  getProducts:   ()            => apiFetch('/products'),
  getProduct:    (id)          => apiFetch(`/products/${id}`),
  addProduct:    (d)           => apiFetch('/products',  { method:'POST', body:JSON.stringify(d) }),
  updateProduct: (id, d)       => apiFetch(`/products/${id}`, { method:'PUT',  body:JSON.stringify(d) }),
  deleteProduct: (id)          => apiFetch(`/products/${id}`, { method:'DELETE' }),
  updatePrice:   (id, price)   => apiFetch(`/products/${id}/price`, { method:'POST', body:JSON.stringify({price}) }),

  getWatchlist:   ()           => apiFetch('/watchlist'),
  addToWatchlist: (pid, tgt)   => apiFetch('/watchlist', { method:'POST', body:JSON.stringify({product_id:pid,target_price:tgt}) }),
  updateTarget:   (id, tgt)    => apiFetch(`/watchlist/${id}`, { method:'PUT', body:JSON.stringify({target_price:tgt}) }),
  removeWatch:    (id)         => apiFetch(`/watchlist/${id}`, { method:'DELETE' }),

  getAlerts:   ()              => apiFetch('/alerts'),
  getStats:    ()              => apiFetch('/alerts/stats'),
  markAllRead: ()              => apiFetch('/alerts/read-all', { method:'PUT' }),

  scrapeUrl:   (url)           => apiFetch('/scrape', { method:'POST', body:JSON.stringify({url}) }),
  predict:     (id)            => apiFetch(`/predict/${id}`),
};