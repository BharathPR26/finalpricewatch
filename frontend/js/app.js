// ── PriceWatch v2 App ─────────────────────────────────────────
let currentUser = null;
let priceChart  = null;
let allProducts = [];
let notifyPref  = true;
let fetchTimer  = null;

const PAGE_LABELS = {
  dashboard: 'Dashboard',
  products:  'My Products',
  detail:    'Product Detail',
  watchlist: 'Watchlist',
  alerts:    'Alerts',
  profile:   'Settings',
};

// ── Bootstrap ─────────────────────────────────────────────────
(async () => {
  try {
    const { user } = await API.me();
    loginSuccess(user);
  } catch { showAuth(); }
})();

function showAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function loginSuccess(user) {
  currentUser = user;
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  ['sidebar-name','profile-name'].forEach(id => document.getElementById(id).textContent = user.name);
  ['sidebar-email','profile-email'].forEach(id => document.getElementById(id).textContent = user.email);
  ['sidebar-avatar','profile-avatar'].forEach(id => document.getElementById(id).textContent = user.name[0].toUpperCase());
  navigate('dashboard');
  refreshAlertBadge();
}

// ── Auth ──────────────────────────────────────────────────────
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) =>
    t.classList.toggle('active', (i===0&&tab==='login')||(i===1&&tab==='register')));
  document.getElementById('form-login').classList.toggle('active', tab==='login');
  document.getElementById('form-register').classList.toggle('active', tab==='register');
}

async function handleLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) return toast('Enter email and password.', 'error');
  try {
    const { user } = await API.login(email, password);
    loginSuccess(user);
    toast(`Welcome back, ${user.name}! 👋`, 'success');
  } catch(e) { toast(e.message, 'error'); }
}

async function handleRegister() {
  const name  = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass  = document.getElementById('reg-password').value;
  if (!name||!email||!pass) return toast('All fields are required.', 'error');
  if (pass.length < 6) return toast('Password must be at least 6 characters.', 'error');
  try {
    const { user } = await API.register(name, email, pass);
    loginSuccess(user);
    toast('Account created! Welcome to PriceWatch 🎉', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

async function handleLogout() {
  await API.logout();
  currentUser = null;
  if (priceChart) { priceChart.destroy(); priceChart = null; }
  showAuth();
}

// ── Navigation ────────────────────────────────────────────────
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item, .topnav-btn').forEach(n => n.classList.remove('active'));

  document.getElementById(`page-${page}`)?.classList.add('active');

  const keyMap = { dashboard:'dashboard', products:'products', detail:'products', watchlist:'watchlist', alerts:'alerts', profile:'profile' };
  const key = keyMap[page] || page;
  document.getElementById(`snav-${key}`)?.classList.add('active');
  document.getElementById(`tnav-${key}`)?.classList.add('active');

  const bc = document.getElementById('bc-page');
  if (bc) bc.textContent = PAGE_LABELS[page] || page;

  closeSidebar();
  if (page === 'dashboard') loadDashboard();
  if (page === 'products')  loadProducts();
  if (page === 'watchlist') loadWatchlist();
  if (page === 'alerts')    loadAlerts();
  if (page === 'profile')   loadProfile();
}

// ── Sidebar Mobile ─────────────────────────────────────────────
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('active');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('active');
}

// ── Dashboard ─────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [statsData, { watchlist }] = await Promise.all([API.getStats(), API.getWatchlist()]);
    const { total_products, watching, total_alerts, unread, best_deals } = statsData;

    document.getElementById('stat-products').textContent = total_products;
    document.getElementById('stat-watching').textContent = watching;
    document.getElementById('stat-alerts').textContent   = total_alerts;
    document.getElementById('stat-unread').textContent   = unread;

    // Best deals
    const dealsSection = document.getElementById('best-deals-section');
    if (best_deals?.length) {
      dealsSection.style.display = 'block';
      document.getElementById('best-deals-list').innerHTML = best_deals.map(d => {
        const drop = ((d.first_price - d.current_price) / d.first_price * 100).toFixed(1);
        return `<div class="alert-item" style="border-left-color:var(--green);cursor:pointer" onclick="loadDetail(${d.product_id})">
          <div class="alert-icon">🏆</div>
          <div class="alert-body">
            <div class="alert-title">${d.name}</div>
            <div class="alert-meta">${d.category} · Price dropped ↓${drop}% from ₹${fmt(d.first_price)}</div>
          </div>
          <div class="alert-price">₹${fmt(d.current_price)}</div>
        </div>`;
      }).join('');
    } else { dealsSection.style.display = 'none'; }

    // Watchlist summary
    const cont = document.getElementById('dashboard-watchlist');
    if (!watchlist.length) {
      cont.innerHTML = `<div class="empty-state">
        <div class="ei">👁️</div>
        <h3>No products being watched yet</h3>
        <p>Add a product and set a target price — we'll alert you automatically when the price drops.</p>
        <button class="btn btn-primary" style="margin-top:14px" onclick="openAddProduct()">+ Add Your First Product</button>
      </div>`;
    } else {
      cont.innerHTML = `<div class="watch-table-wrap">${buildWatchTable(watchlist.slice(0, 6))}</div>`;
    }
  } catch(e) { toast('Failed to load dashboard.', 'error'); }
}

// ── Products ──────────────────────────────────────────────────
async function loadProducts() {
  const grid = document.getElementById('products-grid');
  grid.innerHTML = '<div class="spinner"></div>';
  try {
    const { products } = await API.getProducts();
    allProducts = products;
    renderProductGrid(products);
  } catch(e) { toast('Failed to load products.', 'error'); }
}

function filterProducts(q) {
  const lower = q.toLowerCase();
  renderProductGrid(allProducts.filter(p =>
    p.name.toLowerCase().includes(lower) || p.category.toLowerCase().includes(lower)));
}

function renderProductGrid(products) {
  const grid = document.getElementById('products-grid');
  if (!products.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="ei">🛍️</div>
      <h3>No products yet</h3>
      <p>Add your first product to start automatic price tracking.</p>
      <button class="btn btn-primary" style="margin-top:14px" onclick="openAddProduct()">+ Add Product</button>
    </div>`;
    return;
  }
  grid.innerHTML = products.map(p => {
    const drop = (p.first_price && p.current_price && p.first_price > p.current_price)
      ? ((p.first_price - p.current_price) / p.first_price * 100).toFixed(1) : null;
    return `<div class="product-card" onclick="loadDetail(${p.product_id})">
      ${p.image_url
        ? `<img class="product-img" src="${p.image_url}" alt="${p.name}" onerror="this.style.display='none'">`
        : `<div class="product-img-ph">🛍️</div>`}
      <div class="product-body">
        <div class="product-cat">${p.category}</div>
        <div class="product-name">${p.name}</div>
        <div class="price-row">
          <span class="price-current">${p.current_price ? '₹'+fmt(p.current_price) : 'Not fetched yet'}</span>
          ${p.all_time_low ? `<span class="price-atl">${fmt(p.all_time_low)}</span>` : ''}
          ${drop ? `<span class="drop-pill drop-down">↓${drop}%</span>` : ''}
        </div>
        <div class="last-checked">
          <span>🤖</span>
          <span>${p.price_entries || 0} price snapshot${p.price_entries !== 1 ? 's' : ''} recorded</span>
        </div>
        <div class="product-actions" onclick="event.stopPropagation()">
          <button class="btn btn-outline btn-sm" onclick="loadDetail(${p.product_id})">📈 History</button>
          <button class="btn btn-outline btn-sm" onclick="openUpdatePrice(${p.product_id})">✏️ Update</button>
          <button class="btn btn-danger btn-sm" onclick="deleteProduct(${p.product_id})">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Product Detail ────────────────────────────────────────────
async function loadDetail(id) {
  navigate('detail');
  document.getElementById('detail-content').innerHTML = '<div class="spinner"></div>';
  try {
    const { product, history, watchInfo } = await API.getProduct(id);
    const prices = history.map(h => +h.price);
    const cur    = prices.length ? prices[prices.length - 1] : 0;
    const atl    = prices.length ? Math.min(...prices) : 0;
    const first  = prices.length ? prices[0] : 0;
    const drop   = first > 0 ? ((first - cur) / first * 100).toFixed(1) : 0;

    document.getElementById('detail-content').innerHTML = `
      <div class="detail-header">
        ${product.image_url
          ? `<img class="detail-img" src="${product.image_url}" alt="${product.name}">`
          : `<div class="detail-img" style="background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:30px">🛍️</div>`}
        <div class="detail-meta">
          <span class="tag">${product.category}</span>
          <div class="detail-name" style="margin-top:8px">${product.name}</div>
          <div class="detail-prices">
            <div>
              <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px">Current</div>
              <div class="price-big">₹${fmt(cur)}</div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px">All-Time Low</div>
              <div class="price-big" style="color:var(--green)">₹${fmt(atl)}</div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px">Total Drop</div>
              <div class="price-big" style="color:${drop > 0 ? 'var(--green)' : 'var(--muted)'}">↓${drop}%</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" onclick="openUpdatePrice(${product.product_id})">✏️ Update Price</button>
            <a class="btn btn-outline btn-sm" href="${product.url}" target="_blank">🔗 Open Product</a>
            <button class="btn btn-danger btn-sm" onclick="deleteProduct(${product.product_id})">🗑 Remove</button>
          </div>
        </div>
      </div>

      <div class="chart-card">
        <div class="chart-header">
          <div class="chart-title">📈 Price History</div>
          <span style="font-size:12px;color:var(--muted)">${history.length} data point${history.length !== 1 ? 's' : ''} · Auto-updated every 6h</span>
        </div>
        <canvas id="price-chart" height="80"></canvas>
      </div>

      <div class="section-title">👁️ My Watch Target</div>
      ${watchInfo
        ? `<div class="alert-item" style="margin-bottom:18px">
            <div class="alert-icon">🎯</div>
            <div class="alert-body">
              <div class="alert-title">Watching — alert fires at ₹${fmt(watchInfo.target_price)}</div>
              <div class="alert-meta">Current ₹${fmt(watchInfo.current_price || cur)} · All-time low ₹${fmt(watchInfo.all_time_low || atl)}</div>
            </div>
            ${(watchInfo.current_price || cur) <= watchInfo.target_price
              ? `<span class="drop-pill drop-down">✓ Target Hit!</span>` : ''}
            <button class="btn btn-danger btn-sm" onclick="removeFromWatchlist(${watchInfo.watch_id})">Stop Watching</button>
          </div>`
        : `<div style="margin-bottom:18px">
            <p style="color:var(--muted);font-size:13px;margin-bottom:10px">Set a target price — we'll automatically alert you when it drops that low.</p>
            <div style="display:flex;gap:8px">
              <input type="number" id="watch-target-${id}" placeholder="Target price ₹" style="flex:1"/>
              <button class="btn btn-primary" onclick="addToWatchlist(${id})">🎯 Set Target</button>
            </div>
          </div>`}
    `;
    renderPriceChart(history, watchInfo?.target_price);
  } catch(e) { toast('Failed to load product details.', 'error'); }
}

function renderPriceChart(history, target) {
  if (priceChart) { priceChart.destroy(); priceChart = null; }
  const ctx = document.getElementById('price-chart');
  if (!ctx || !history.length) return;

  const labels = history.map(h =>
    new Date(h.recorded_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }));
  const prices = history.map(h => parseFloat(h.price));

  const datasets = [{
    label: 'Price', data: prices,
    borderColor: '#f5a623', backgroundColor: 'rgba(245,166,35,.07)',
    borderWidth: 2, pointRadius: 4,
    pointBackgroundColor: '#f5a623', pointBorderColor: '#0c0e13',
    pointBorderWidth: 2, tension: .35, fill: true,
  }];

  if (target) datasets.push({
    label: 'Your Target', data: Array(labels.length).fill(+target),
    borderColor: '#27d872', borderDash: [5, 4],
    borderWidth: 1.5, pointRadius: 0, fill: false,
  });

  priceChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#7c82a0', font: { family: 'DM Mono', size: 12 } } },
        tooltip: {
          backgroundColor: '#1e2230', borderColor: '#2c3045', borderWidth: 1,
          titleColor: '#eef0f6', bodyColor: '#7c82a0',
          callbacks: { label: ctx => ` ₹${fmt(ctx.raw)}` },
        },
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#7c82a0', font: { size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#7c82a0', font: { size: 11 }, callback: v => '₹' + fmt(v) } },
      },
    },
  });
}

// ── Watchlist ─────────────────────────────────────────────────
async function loadWatchlist() {
  const cont = document.getElementById('watchlist-content');
  cont.innerHTML = '<div class="spinner"></div>';
  try {
    const { watchlist } = await API.getWatchlist();
    if (!watchlist.length) {
      cont.innerHTML = `<div class="empty-state">
        <div class="ei">👁️</div>
        <h3>Nothing in your watchlist</h3>
        <p>Open any product and set a target price to start watching.</p>
      </div>`;
      return;
    }
    cont.innerHTML = `<div class="watch-table-wrap">${buildWatchTable(watchlist)}</div>`;
  } catch(e) { toast('Failed to load watchlist.', 'error'); }
}

function buildWatchTable(list) {
  const rows = list.map(w => {
    const drop = w.drop_pct;
    const dropEl = drop > 0
      ? `<span class="drop-pill drop-down">↓${drop}%</span>`
      : drop < 0 ? `<span class="drop-pill drop-up">↑${Math.abs(drop)}%</span>`
      : `<span style="color:var(--muted);font-size:12px">—</span>`;
    const hit = w.current_price && w.current_price <= w.target_price;
    return `<tr>
      <td style="cursor:pointer" onclick="loadDetail(${w.product_id})">
        <div style="font-weight:600;font-size:14px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${w.name}</div>
        <div style="font-size:11px;color:var(--muted)">${w.category}</div>
      </td>
      <td class="price-mono">${w.current_price ? '₹'+fmt(w.current_price) : '—'}</td>
      <td class="price-mono" style="color:var(--accent)">₹${fmt(w.target_price)}</td>
      <td class="price-mono" style="color:var(--green)">${w.all_time_low ? '₹'+fmt(w.all_time_low) : '—'}</td>
      <td>${dropEl}</td>
      <td>${hit
        ? '<span class="drop-pill drop-down">✓ Hit!</span>'
        : '<span style="color:var(--green);font-size:12px">🤖 Watching</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-outline btn-sm" onclick="loadDetail(${w.product_id})">Chart</button>
        <button class="btn btn-danger btn-sm" style="margin-left:5px" onclick="removeFromWatchlist(${w.watch_id})">✕</button>
      </td>
    </tr>`;
  }).join('');
  return `<table class="watch-table">
    <thead><tr>
      <th>Product</th><th>Current</th><th>Your Target</th><th>All-Time Low</th><th>Drop</th><th>Status</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ── Alerts ────────────────────────────────────────────────────
async function loadAlerts() {
  const list = document.getElementById('alerts-list');
  list.innerHTML = '<div class="spinner"></div>';
  try {
    const { alerts } = await API.getAlerts();
    if (!alerts.length) {
      list.innerHTML = `<div class="empty-state">
        <div class="ei">🔔</div>
        <h3>No alerts yet</h3>
        <p>Alerts appear here automatically when a product price drops to your target. Add a product and set a target price to get started.</p>
      </div>`;
      return;
    }
    list.innerHTML = alerts.map(a => `
      <div class="alert-item ${a.is_read ? 'read' : ''}">
        <div class="alert-icon">🎯</div>
        <div class="alert-body">
          <div class="alert-title">
            ${a.product_name} hit your target!
            ${a.email_sent ? '<span class="email-badge">📧 Gmail sent</span>' : ''}
          </div>
          <div class="alert-meta">
            Your target ₹${fmt(a.target_price)} · Price dropped to ₹${fmt(a.triggered_price)} · ${new Date(a.triggered_at).toLocaleString('en-IN')}
          </div>
        </div>
        <div class="alert-price">₹${fmt(a.triggered_price)}</div>
      </div>`).join('');
    refreshAlertBadge();
  } catch(e) { toast('Failed to load alerts.', 'error'); }
}

async function markAllRead() {
  try {
    await API.markAllRead();
    toast('All alerts marked as read.', 'success');
    loadAlerts();
    refreshAlertBadge();
  } catch(e) { toast(e.message, 'error'); }
}

async function refreshAlertBadge() {
  try {
    const { unread_count } = await API.getAlerts();
    const badge = document.getElementById('alert-badge');
    const dot   = document.getElementById('topnav-dot');
    if (badge) { badge.style.display = unread_count > 0 ? 'inline' : 'none'; badge.textContent = unread_count; }
    if (dot)   dot.style.display = unread_count > 0 ? 'block' : 'none';
  } catch {}
}

// ── Profile ───────────────────────────────────────────────────
function loadProfile() {
  const toggle = document.getElementById('email-toggle');
  toggle.classList.toggle('on', notifyPref);
}

async function toggleEmailNotif() {
  notifyPref = !document.getElementById('email-toggle').classList.contains('on');
  document.getElementById('email-toggle').classList.toggle('on', notifyPref);
  try {
    await API.setNotif(notifyPref);
    toast(notifyPref ? '📧 Gmail alerts enabled' : 'Gmail alerts disabled', 'info');
  } catch(e) { toast(e.message, 'error'); }
}

// ── Add Product ───────────────────────────────────────────────
function openAddProduct() {
  ['add-url','add-name','add-image','add-price','add-target'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const btn = document.getElementById('fetch-btn');
  if (btn) { btn.textContent = '🔍 Fetch'; btn.disabled = false; }
  hideStatus(); hideScrapePreview();
  openModal('modal-add-product');
}

async function submitAddProduct() {
  const name  = document.getElementById('add-name').value.trim();
  const url   = document.getElementById('add-url').value.trim();
  const cat   = document.getElementById('add-category').value;
  const img   = document.getElementById('add-image').value.trim();
  const price = parseFloat(document.getElementById('add-price').value);
  const tgt   = parseFloat(document.getElementById('add-target').value);
  if (!name || !url || !price) return toast('Product name, URL and current price are required.', 'error');
  try {
    const { product_id } = await API.addProduct({ name, url, category: cat, image_url: img, initial_price: price });
    if (tgt) await API.addToWatchlist(product_id, tgt);
    closeModal('modal-add-product');
    toast(`${name} is now being tracked! 🤖`, 'success');
    loadProducts();
  } catch(e) { toast(e.message, 'error'); }
}

// ── Scraper UI ─────────────────────────────────────────────────
function onUrlInput(val) {
  clearTimeout(fetchTimer);
  if (!val.trim()) { hideStatus(); hideScrapePreview(); return; }
  if (val.startsWith('http')) fetchTimer = setTimeout(fetchFromUrl, 1400);
}

async function fetchFromUrl() {
  const url = document.getElementById('add-url').value.trim();
  if (!url) return toast('Paste a product URL first.', 'error');
  const btn = document.getElementById('fetch-btn');
  btn.textContent = '⏳ Fetching…'; btn.disabled = true;
  hideScrapePreview();
  showStatus('Fetching product info — this can take up to 20 seconds…', 'loading');
  try {
    const r = await API.scrapeUrl(url);
    if (r.success && r.price) {
      if (r.name)  document.getElementById('add-name').value  = r.name;
      if (r.image) document.getElementById('add-image').value = r.image;
      document.getElementById('add-price').value = r.price;
      showScrapePreview(r);
      showStatus(`Price found: ₹${fmt(r.price)} — check the fields below and click "Start Tracking".`, 'success');
    } else {
      if (r.name)  document.getElementById('add-name').value  = r.name;
      if (r.image) document.getElementById('add-image').value = r.image;
      if (r.name || r.image) showScrapePreview(r);
      showStatus((r.error || 'Price not detected automatically. Please enter the current price manually.'), 'warning');
    }
  } catch(e) { showStatus('Fetch failed. Please enter the details manually.', 'error'); }
  finally { btn.textContent = '🔄 Re-fetch'; btn.disabled = false; }
}

function showScrapePreview(r) {
  const el = document.getElementById('scrape-preview');
  document.getElementById('preview-img').src = r.image || '';
  document.getElementById('preview-img').style.display = r.image ? 'block' : 'none';
  document.getElementById('preview-name').textContent  = r.name  || 'Name not detected';
  document.getElementById('preview-price').textContent = r.price ? `₹${fmt(r.price)}` : 'Price not detected';
  el.style.display = 'flex';
}
function hideScrapePreview() {
  const el = document.getElementById('scrape-preview');
  if (el) el.style.display = 'none';
}
function showStatus(msg, type) {
  const el = document.getElementById('scrape-status');
  if (!el) return;
  const styles = {
    loading: 'background:rgba(74,158,255,.08);border:1px solid rgba(74,158,255,.25);color:#4a9eff',
    success: 'background:rgba(39,216,114,.08);border:1px solid rgba(39,216,114,.25);color:#27d872',
    warning: 'background:rgba(245,166,35,.08);border:1px solid rgba(245,166,35,.25);color:#f5a623',
    error:   'background:rgba(255,77,106,.08);border:1px solid rgba(255,77,106,.25);color:#ff4d6a',
  };
  const icons = { loading:'⏳', success:'✓', warning:'⚠', error:'✕' };
  el.style.cssText = `display:block;margin-bottom:12px;padding:10px 13px;border-radius:8px;font-size:13px;line-height:1.5;${styles[type]}`;
  el.innerHTML = `${icons[type]} ${msg}`;
}
function hideStatus() {
  const el = document.getElementById('scrape-status');
  if (el) el.style.display = 'none';
}

// ── Update Price ───────────────────────────────────────────────
function openUpdatePrice(id) {
  document.getElementById('update-price-pid').value = id;
  document.getElementById('update-price-val').value = '';
  openModal('modal-update-price');
  setTimeout(() => document.getElementById('update-price-val').focus(), 200);
}

async function submitUpdatePrice() {
  const pid   = document.getElementById('update-price-pid').value;
  const price = parseFloat(document.getElementById('update-price-val').value);
  if (!price) return toast('Enter a valid price.', 'error');
  try {
    const r = await API.updatePrice(pid, price);
    closeModal('modal-update-price');
    if (r.alerts_triggered > 0) {
      toast(r.emails_dispatched > 0
        ? `Target hit! 🎯 Gmail alert sent!`
        : `Target hit! 🎯 Alert created!`, 'success');
    } else {
      toast('Price updated. No target hit yet.', 'info');
    }
    refreshAlertBadge();
    if (document.getElementById('page-detail').classList.contains('active')) loadDetail(pid);
    else loadProducts();
  } catch(e) { toast(e.message, 'error'); }
}

// ── Watchlist Actions ──────────────────────────────────────────
async function addToWatchlist(pid) {
  const input = document.getElementById(`watch-target-${pid}`);
  const t = parseFloat(input?.value);
  if (!t) return toast('Enter a target price.', 'error');
  try {
    await API.addToWatchlist(pid, t);
    toast('Watching! You\'ll get a Gmail alert when the price drops. 🎯', 'success');
    loadDetail(pid);
  } catch(e) { toast(e.message, 'error'); }
}

async function removeFromWatchlist(wid) {
  try {
    await API.removeWatch(wid);
    toast('Removed from watchlist.', 'info');
    if (document.getElementById('page-watchlist').classList.contains('active')) loadWatchlist();
    if (document.getElementById('page-detail').classList.contains('active')) {
      const pid = document.getElementById('update-price-pid').value;
      if (pid) loadDetail(pid);
    }
    loadDashboard();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteProduct(id) {
  if (!confirm('Remove this product and all its price history?')) return;
  try {
    await API.deleteProduct(id);
    toast('Product removed.', 'info');
    navigate('products');
  } catch(e) { toast(e.message, 'error'); }
}

// ── Modals ─────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(m =>
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); }));

// ── Toast ──────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const wrap = document.getElementById('toast-wrap');
  const el   = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${{success:'✓',error:'✕',info:'ℹ'}[type]||'ℹ'}</span><span>${msg}</span>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ── Format ─────────────────────────────────────────────────────
function fmt(n) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}