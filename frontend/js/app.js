// ── PriceWatch v2 — Complete App ──────────────────────────────
let currentUser = null;
let priceChart  = null;
let allProducts = [];
let notifyPref  = true;
let fetchTimer  = null;
let currentDetailId = null;

// ── URL ROUTING ───────────────────────────────────────────────
// Maps /login /register /dashboard /products etc to app pages
const ROUTES = {
  '/':            () => currentUser ? navigate('dashboard') : navigate('login'),
  '/login':       () => navigate('login'),
  '/register':    () => navigate('register'),
  '/dashboard':   () => navigate('dashboard'),
  '/products':    () => navigate('products'),
  '/watchlist':   () => navigate('watchlist'),
  '/alerts':      () => navigate('alerts'),
  '/settings':    () => navigate('profile'),
  '/predict':     () => navigate('products'),
};

function handleRoute() {
  const path = window.location.pathname;
  // Handle /products/42 style URLs
  const productMatch = path.match(/^\/products\/(\d+)$/);
  if (productMatch) { loadDetail(parseInt(productMatch[1])); return; }
  const handler = ROUTES[path];
  if (handler) handler();
  else if (currentUser) navigate('dashboard');
  else navigate('login');
}

function pushRoute(path) {
  if (window.location.pathname !== path)
    window.history.pushState({}, '', path);
}

window.addEventListener('popstate', handleRoute);

// ── Bootstrap ─────────────────────────────────────────────────
(async () => {
  try {
    const { user } = await API.me();
    loginSuccess(user, false);
    handleRoute();
  } catch {
    // Not logged in — show auth based on URL
    const path = window.location.pathname;
    if (path === '/register') showAuth('register');
    else showAuth('login');
  }
})();

function showAuth(tab = 'login') {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  switchAuthTab(tab);
}

function loginSuccess(user, redirect = true) {
  currentUser = user;
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  ['sidebar-name','profile-name'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = user.name;
  });
  ['sidebar-email','profile-email'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = user.email;
  });
  ['sidebar-avatar','profile-avatar'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = user.name[0].toUpperCase();
  });
  if (redirect) { navigate('dashboard'); pushRoute('/dashboard'); }
  refreshAlertBadge();
}

// ── Auth ──────────────────────────────────────────────────────
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) =>
    t.classList.toggle('active', (i===0 && tab==='login') || (i===1 && tab==='register')));
  document.getElementById('form-login').classList.toggle('active', tab === 'login');
  document.getElementById('form-register').classList.toggle('active', tab === 'register');
  pushRoute(tab === 'register' ? '/register' : '/login');
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pw    = document.getElementById('login-password').value;
  if (!email || !pw) return toast('Enter email and password.', 'error');
  try {
    const { user } = await API.login(email, pw);
    loginSuccess(user);
    toast(`Welcome back, ${user.name}! 👋`, 'success');
  } catch(e) { toast(e.message, 'error'); }
}

async function handleRegister() {
  const name  = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pw    = document.getElementById('reg-password').value;
  if (!name||!email||!pw) return toast('All fields are required.', 'error');
  if (pw.length < 6) return toast('Password must be at least 6 characters.', 'error');
  try {
    const { user } = await API.register(name, email, pw);
    loginSuccess(user);
    toast('Welcome to PriceWatch! 🎉', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

async function handleLogout() {
  await API.logout();
  currentUser = null;
  if (priceChart) { priceChart.destroy(); priceChart = null; }
  pushRoute('/login');
  showAuth('login');
}

// ── Navigation ────────────────────────────────────────────────
const PAGE_ROUTES = {
  dashboard:'dashboard', products:'products', detail:'products',
  watchlist:'watchlist', alerts:'alerts', profile:'settings',
};
const PAGE_LABELS = {
  login:'Login', register:'Register',
  dashboard:'Dashboard', products:'My Products', detail:'Product Detail',
  watchlist:'Watchlist', alerts:'Alerts', profile:'Settings',
};

function navigate(page) {
  // Auth pages
  if (page === 'login')    { showAuth('login');    return; }
  if (page === 'register') { showAuth('register'); return; }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item, .topnav-btn, .bnav-btn').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  const navKey = PAGE_ROUTES[page] || page;
  document.getElementById(`snav-${navKey}`)?.classList.add('active');
  document.getElementById(`tnav-${navKey}`)?.classList.add('active');
  document.getElementById(`bnav-${navKey}`)?.classList.add('active');

  // Update browser URL
  const routeMap = {
    dashboard:'/dashboard', products:'/products', detail:`/products/${currentDetailId||''}`,
    watchlist:'/watchlist', alerts:'/alerts', profile:'/settings',
  };
  if (routeMap[page]) pushRoute(routeMap[page]);

  closeSidebar();

  if (page === 'dashboard') loadDashboard();
  if (page === 'products')  loadProducts();
  if (page === 'watchlist') loadWatchlist();
  if (page === 'alerts')    loadAlerts();
  if (page === 'profile')   loadProfile();
}

function openSidebar()  {
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
    const [stats, { watchlist }] = await Promise.all([API.getStats(), API.getWatchlist()]);
    document.getElementById('stat-products').textContent = stats.total_products;
    document.getElementById('stat-watching').textContent = stats.watching;
    document.getElementById('stat-alerts').textContent   = stats.total_alerts;
    document.getElementById('stat-unread').textContent   = stats.unread;

    const dealsSection = document.getElementById('best-deals-section');
    if (stats.best_deals?.length) {
      dealsSection.style.display = 'block';
      document.getElementById('best-deals-list').innerHTML = stats.best_deals.map(d => {
        const drop = ((d.first_price - d.current_price) / d.first_price * 100).toFixed(1);
        return `<div class="alert-item" style="border-left-color:var(--green);cursor:pointer" onclick="loadDetail(${d.product_id})">
          <div class="alert-icon">🏆</div>
          <div class="alert-body">
            <div class="alert-title">${d.name}</div>
            <div class="alert-meta">${d.category} · ↓${drop}% from ₹${fmt(d.first_price)}</div>
          </div>
          <div class="alert-price">₹${fmt(d.current_price)}</div>
        </div>`;
      }).join('');
    } else { dealsSection.style.display = 'none'; }

    const cont = document.getElementById('dashboard-watchlist');
    if (!watchlist.length) {
      cont.innerHTML = `<div class="empty-state">
        <div class="ei">👁️</div><h3>No products being watched yet</h3>
        <p>Add a product and set a target price.</p>
        <button class="btn btn-primary" style="margin-top:14px" onclick="openAddProduct()">+ Add First Product</button>
      </div>`;
    } else {
      cont.innerHTML = `<div class="watch-table-wrap">${buildWatchTable(watchlist.slice(0,6))}</div>`;
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
  const lo = q.toLowerCase();
  renderProductGrid(allProducts.filter(p =>
    p.name.toLowerCase().includes(lo) || p.category.toLowerCase().includes(lo)));
}

function renderProductGrid(products) {
  const grid = document.getElementById('products-grid');
  if (!products.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="ei">🛍️</div><h3>No products yet</h3>
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
          <span class="price-current">${p.current_price ? '₹'+fmt(p.current_price) : 'Not fetched'}</span>
          ${p.all_time_low ? `<span class="price-atl">${fmt(p.all_time_low)}</span>` : ''}
          ${drop ? `<span class="drop-pill drop-down">↓${drop}%</span>` : ''}
        </div>
        <div class="last-checked"><span>🤖</span><span>${p.price_entries||0} snapshots</span></div>
        <div class="product-actions" onclick="event.stopPropagation()">
          <button class="btn btn-outline btn-sm" onclick="loadDetail(${p.product_id})">📈 View</button>
          <button class="btn btn-outline btn-sm" onclick="openUpdatePrice(${p.product_id})">✏️ Update</button>
          <button class="btn btn-danger btn-sm"  onclick="deleteProduct(${p.product_id})">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Product Detail (with AI Prediction) ───────────────────────
async function loadDetail(id) {
  currentDetailId = id;
  navigate('detail');
  pushRoute(`/products/${id}`);
  document.getElementById('detail-content').innerHTML = '<div class="spinner"></div>';
  try {
    const { product, history, watchInfo } = await API.getProduct(id);
    const prices = history.map(h => +h.price);
    const cur    = prices.length ? prices[prices.length-1] : 0;
    const atl    = prices.length ? Math.min(...prices) : 0;
    const first  = prices.length ? prices[0] : 0;
    const drop   = first > 0 ? ((first-cur)/first*100).toFixed(1) : 0;

    document.getElementById('detail-content').innerHTML = `
      <!-- Product Header -->
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
            <a class="btn btn-outline btn-sm" href="${product.url}" target="_blank">🔗 Visit Product</a>
            <button class="btn btn-danger btn-sm" onclick="deleteProduct(${product.product_id})">🗑 Remove</button>
          </div>
        </div>
      </div>

      <!-- Price History Chart -->
      <div class="chart-card" id="chart-card-main">
        <div class="chart-header">
          <div class="chart-title">📈 Price History + AI Forecast</div>
          <span style="font-size:12px;color:var(--muted)">${history.length} snapshots · dotted = AI prediction</span>
        </div>
        <canvas id="price-chart" height="90"></canvas>
      </div>

      <!-- AI PREDICTION CARD -->
      <div class="ai-prediction-card" id="ai-card">
        <div class="ai-card-header">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:22px">🤖</span>
            <div>
              <div class="ai-card-title">AI Price Prediction</div>
              <div class="ai-card-sub">Next 7 days forecast using Linear Regression</div>
            </div>
          </div>
          <div class="ai-loading" id="ai-loading">
            <div class="spinner" style="width:18px;height:18px;margin:0"></div>
            <span>Analysing...</span>
          </div>
        </div>
        <div id="ai-body"></div>
      </div>

      <!-- Watch Target -->
      <div class="section-title" style="margin-top:20px">👁️ My Watch Target</div>
      ${watchInfo
        ? `<div class="alert-item" style="margin-bottom:18px">
            <div class="alert-icon">🎯</div>
            <div class="alert-body">
              <div class="alert-title">Alert fires at ₹${fmt(watchInfo.target_price)}</div>
              <div class="alert-meta">Current ₹${fmt(watchInfo.current_price||cur)} · ATL ₹${fmt(watchInfo.all_time_low||atl)}</div>
            </div>
            ${(watchInfo.current_price||cur) <= watchInfo.target_price ? `<span class="drop-pill drop-down">✓ Hit!</span>` : ''}
            <button class="btn btn-danger btn-sm" onclick="removeFromWatchlist(${watchInfo.watch_id})">Stop</button>
          </div>`
        : `<div style="margin-bottom:18px">
            <p style="color:var(--muted);font-size:13px;margin-bottom:10px">Set a target price — get a Gmail alert automatically when it drops.</p>
            <div style="display:flex;gap:8px">
              <input type="number" id="watch-target-${id}" placeholder="Target price ₹" style="flex:1" inputmode="numeric"/>
              <button class="btn btn-primary" onclick="addToWatchlist(${id})">🎯 Set Target</button>
            </div>
          </div>`}
    `;

    // Draw history chart first
    renderPriceChart(history, watchInfo?.target_price, null);

    // Load AI prediction async
    loadPrediction(id, history, watchInfo?.target_price);

  } catch(e) { toast('Failed to load product details.', 'error'); }
}

// ── AI Prediction ─────────────────────────────────────────────
async function loadPrediction(productId, history, target) {
  const aiBody    = document.getElementById('ai-body');
  const aiLoading = document.getElementById('ai-loading');
  if (!aiBody) return;

  try {
    const data = await API.predict(productId);

    if (aiLoading) aiLoading.style.display = 'none';

    if (data.error && !data.prediction?.length) {
      aiBody.innerHTML = `
        <div class="ai-not-enough">
          <span style="font-size:22px">📊</span>
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text)">Not enough data yet</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">${data.error}</div>
          </div>
        </div>`;
      return;
    }

    const trendColor = data.trend==='falling' ? 'var(--green)' : data.trend==='rising' ? 'var(--red)' : 'var(--accent)';
    const trendIcon  = data.trend==='falling' ? '📉' : data.trend==='rising' ? '📈' : '➡️';
    const recColor   = data.recommendation==='WAIT' ? 'var(--green)' : data.recommendation==='BUY NOW' ? 'var(--red)' : 'var(--accent)';
    const confColor  = data.confidence>=70 ? 'var(--green)' : data.confidence>=40 ? 'var(--accent)' : 'var(--red)';

    aiBody.innerHTML = `
      <!-- Insight -->
      <div class="ai-insight-banner">
        <div class="ai-insight-text">${data.insight}</div>
      </div>

      <!-- Key metrics -->
      <div class="ai-metrics">
        <div class="ai-metric">
          <div class="ai-metric-label">Trend</div>
          <div class="ai-metric-icon">${trendIcon}</div>
          <div class="ai-metric-value" style="color:${trendColor}">${(data.trend||'').toUpperCase()}</div>
        </div>
        <div class="ai-metric" style="border:2px solid ${recColor}">
          <div class="ai-metric-label">Recommendation</div>
          <div class="ai-metric-icon">🛒</div>
          <div class="ai-metric-value" style="color:${recColor}">${data.recommendation}</div>
        </div>
        <div class="ai-metric">
          <div class="ai-metric-label">Best Price</div>
          <div class="ai-metric-icon">💰</div>
          <div class="ai-metric-value" style="color:var(--green)">₹${fmt(data.min_predicted)}</div>
          <div class="ai-metric-sub">${data.best_buy_day}</div>
        </div>
        <div class="ai-metric">
          <div class="ai-metric-label">Confidence</div>
          <div class="ai-metric-icon">🎯</div>
          <div class="ai-metric-value" style="color:${confColor}">${data.confidence}%</div>
          <div class="ai-metric-sub">${data.data_points} pts</div>
        </div>
      </div>

      <!-- 7-day forecast grid -->
      <div class="ai-forecast-label">7-Day Price Forecast</div>
      <div class="ai-forecast-grid">
        ${data.prediction.map((p, i) => {
          const isMin  = p.price === data.min_predicted;
          const dt     = new Date(p.date);
          const day    = dt.toLocaleDateString('en-IN', {weekday:'short'});
          const date   = dt.getDate();
          const priceK = p.price >= 1000 ? (p.price/1000).toFixed(1)+'k' : Math.round(p.price);
          return `<div class="ai-day ${isMin ? 'ai-day-best' : ''}">
            <div class="ai-day-name">${day}</div>
            <div class="ai-day-num">${date}</div>
            <div class="ai-day-price">₹${priceK}</div>
            ${isMin ? '<div class="ai-day-badge">BEST</div>' : ''}
          </div>`;
        }).join('')}
      </div>

      ${data.drop_detected ? `<div class="ai-drop-alert">🚨 Sudden price drop detected in forecast window</div>` : ''}
      ${data.expected_savings > 0 ? `<div class="ai-savings">💡 Potential savings if you wait: ₹${fmt(data.expected_savings)}</div>` : ''}

      <div class="ai-footer">
        R² accuracy score: ${data.r2_score} · ${data.cached ? 'Cached' : 'Fresh'} · Linear Regression model
      </div>
    `;

    // Redraw chart WITH prediction overlay
    renderPriceChart(history, target, data.prediction);

  } catch(e) {
    if (aiLoading) aiLoading.style.display = 'none';
    if (aiBody) aiBody.innerHTML = `<div style="padding:8px;font-size:12px;color:var(--muted)">Prediction unavailable. Try again later.</div>`;
  }
}

// ── Price Chart (history + AI forecast overlay) ────────────────
function renderPriceChart(history, target, predictions) {
  if (priceChart) { priceChart.destroy(); priceChart = null; }
  const ctx = document.getElementById('price-chart');
  if (!ctx || !history?.length) return;

  const histLabels = history.map(h =>
    new Date(h.recorded_at || h.date).toLocaleDateString('en-IN', {month:'short', day:'numeric'}));
  const histPrices = history.map(h => parseFloat(h.price));

  const datasets = [{
    label: 'Actual Price',
    data: histPrices,
    borderColor: '#f5a623',
    backgroundColor: 'rgba(245,166,35,.07)',
    borderWidth: 2, pointRadius: 4,
    pointBackgroundColor: '#f5a623',
    pointBorderColor: '#0c0e13',
    pointBorderWidth: 2,
    tension: .35, fill: true,
  }];

  let allLabels = [...histLabels];

  // Add AI prediction as dotted purple line
  if (predictions?.length) {
    const predLabels = predictions.map(p =>
      new Date(p.date).toLocaleDateString('en-IN', {month:'short', day:'numeric'}));
    const predPrices = predictions.map(p => parseFloat(p.price));

    // Bridge: null for all history except last point, then predictions
    const bridgeData = [
      ...Array(histPrices.length - 1).fill(null),
      histPrices[histPrices.length - 1],
      ...predPrices,
    ];

    allLabels = [...histLabels, ...predLabels];

    datasets.push({
      label: 'AI Forecast',
      data: bridgeData,
      borderColor: '#9b7df8',
      backgroundColor: 'rgba(155,125,248,.05)',
      borderWidth: 2,
      borderDash: [7, 4],
      pointRadius: (ctx) => ctx.dataIndex < histPrices.length ? 0 : 3,
      pointBackgroundColor: '#9b7df8',
      pointBorderColor: '#0c0e13',
      pointBorderWidth: 1.5,
      tension: .35,
      fill: false,
    });
  }

  // Target line
  if (target) datasets.push({
    label: 'Your Target',
    data: Array(allLabels.length).fill(+target),
    borderColor: '#27d872',
    borderDash: [5,4],
    borderWidth: 1.5,
    pointRadius: 0,
    fill: false,
  });

  priceChart = new Chart(ctx, {
    type: 'line',
    data: { labels: allLabels, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color:'#7c82a0', font:{family:'DM Mono',size:11}, usePointStyle:true, pointStyleWidth:8 },
        },
        tooltip: {
          backgroundColor: '#1e2230', borderColor:'#2c3045', borderWidth:1,
          titleColor: '#eef0f6', bodyColor:'#7c82a0',
          callbacks: { label: c => c.raw != null ? ` ${c.dataset.label}: ₹${fmt(c.raw)}` : '' },
        },
      },
      scales: {
        x: { grid:{color:'rgba(255,255,255,.04)'}, ticks:{color:'#7c82a0',font:{size:10},maxRotation:45} },
        y: { grid:{color:'rgba(255,255,255,.04)'}, ticks:{color:'#7c82a0',font:{size:10},callback:v=>'₹'+fmt(v)} },
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
        <div class="ei">👁️</div><h3>Nothing in your watchlist</h3>
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
        <div style="font-weight:600;font-size:13px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${w.name}</div>
        <div style="font-size:11px;color:var(--muted)">${w.category}</div>
      </td>
      <td class="price-mono">${w.current_price ? '₹'+fmt(w.current_price) : '—'}</td>
      <td class="price-mono" style="color:var(--accent)">₹${fmt(w.target_price)}</td>
      <td class="price-mono" style="color:var(--green)">${w.all_time_low ? '₹'+fmt(w.all_time_low) : '—'}</td>
      <td>${dropEl}</td>
      <td>${hit ? '<span class="drop-pill drop-down">✓ Hit!</span>' : '<span style="color:var(--green);font-size:12px">🤖 Watching</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-outline btn-sm" onclick="loadDetail(${w.product_id})">View</button>
        <button class="btn btn-danger btn-sm" style="margin-left:4px" onclick="removeFromWatchlist(${w.watch_id})">✕</button>
      </td>
    </tr>`;
  }).join('');
  return `<table class="watch-table">
    <thead><tr>
      <th>Product</th><th>Current</th><th>Target</th><th>ATL</th><th>Drop</th><th>Status</th><th></th>
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
        <div class="ei">🔔</div><h3>No alerts yet</h3>
        <p>Alerts appear automatically when a product hits your target price.</p>
      </div>`;
      return;
    }
    list.innerHTML = alerts.map(a => `
      <div class="alert-item ${a.is_read ? 'read' : ''}" onclick="loadDetail(${a.product_id})" style="cursor:pointer">
        <div class="alert-icon">🎯</div>
        <div class="alert-body">
          <div class="alert-title">${a.product_name} hit your target!
            ${a.email_sent ? '<span class="email-badge">📧 Gmail</span>' : ''}
          </div>
          <div class="alert-meta">
            Target ₹${fmt(a.target_price)} · Dropped to ₹${fmt(a.triggered_price)} · ${new Date(a.triggered_at).toLocaleString('en-IN')}
          </div>
        </div>
        <div class="alert-price">₹${fmt(a.triggered_price)}</div>
      </div>`).join('');
    refreshAlertBadge();
  } catch(e) { toast('Failed to load alerts.', 'error'); }
}

async function markAllRead() {
  try { await API.markAllRead(); toast('All read.', 'success'); loadAlerts(); refreshAlertBadge(); }
  catch(e) { toast(e.message, 'error'); }
}

async function refreshAlertBadge() {
  try {
    const { unread } = await API.getStats();
    const count = Number(unread || 0);
    ['alert-badge','bnav-alerts-badge'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.style.display = count > 0 ? 'inline' : 'none'; el.textContent = count; }
    });
    const dot = document.getElementById('topnav-dot');
    if (dot) dot.style.display = count > 0 ? 'block' : 'none';
  } catch {}
}

// ── Profile ───────────────────────────────────────────────────
function loadProfile() {
  const toggle = document.getElementById('email-toggle');
  if (toggle) toggle.classList.toggle('on', notifyPref);
}
async function toggleEmailNotif() {
  notifyPref = !document.getElementById('email-toggle').classList.contains('on');
  document.getElementById('email-toggle').classList.toggle('on', notifyPref);
  try { await API.setNotif(notifyPref); toast(notifyPref ? '📧 Gmail alerts ON' : 'Gmail alerts OFF', 'info'); }
  catch(e) { toast(e.message, 'error'); }
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
  if (!name||!url||!price) return toast('Name, URL and price are required.', 'error');
  try {
    const { product_id } = await API.addProduct({ name, url, category:cat, image_url:img, initial_price:price });
    if (tgt) await API.addToWatchlist(product_id, tgt);
    closeModal('modal-add-product');
    toast(`${name} is now being tracked! 🤖`, 'success');
    loadProducts();
  } catch(e) { toast(e.message, 'error'); }
}

// ── Scraper UI ────────────────────────────────────────────────
function onUrlInput(val) {
  clearTimeout(fetchTimer);
  if (!val.trim()) { hideStatus(); hideScrapePreview(); return; }
  if (val.startsWith('http')) fetchTimer = setTimeout(fetchFromUrl, 1400);
}

async function fetchFromUrl() {
  const url = document.getElementById('add-url').value.trim();
  if (!url) return;
  const btn = document.getElementById('fetch-btn');
  btn.textContent = '⏳'; btn.disabled = true;
  hideScrapePreview();
  showStatus('Fetching product info — up to 20 seconds…', 'loading');
  try {
    const r = await API.scrapeUrl(url);
    if (r.success && r.price) {
      if (r.name)  document.getElementById('add-name').value  = r.name;
      if (r.image) document.getElementById('add-image').value = r.image;
      document.getElementById('add-price').value = r.price;
      showScrapePreview(r);
      showStatus(`✓ Price found: ₹${fmt(r.price)}`, 'success');
    } else {
      if (r.name)  document.getElementById('add-name').value  = r.name;
      if (r.image) document.getElementById('add-image').value = r.image;
      if (r.name || r.image) showScrapePreview(r);
      showStatus(r.error || 'Price not detected. Enter manually.', 'warning');
    }
  } catch { showStatus('Fetch failed. Enter details manually.', 'error'); }
  finally { btn.textContent = '🔄 Re-fetch'; btn.disabled = false; }
}

function showScrapePreview(r) {
  document.getElementById('preview-img').src = r.image || '';
  document.getElementById('preview-img').style.display = r.image ? 'block' : 'none';
  document.getElementById('preview-name').textContent  = r.name  || 'Name not detected';
  document.getElementById('preview-price').textContent = r.price ? `₹${fmt(r.price)}` : 'Not detected';
  document.getElementById('scrape-preview').style.display = 'flex';
}
function hideScrapePreview() {
  const el = document.getElementById('scrape-preview'); if (el) el.style.display = 'none';
}
function showStatus(msg, type) {
  const el = document.getElementById('scrape-status');
  if (!el) return;
  const colors = {
    loading:'rgba(74,158,255,.08);border:1px solid rgba(74,158,255,.25);color:#4a9eff',
    success:'rgba(39,216,114,.08);border:1px solid rgba(39,216,114,.25);color:#27d872',
    warning:'rgba(245,166,35,.08);border:1px solid rgba(245,166,35,.25);color:#f5a623',
    error:  'rgba(255,77,106,.08);border:1px solid rgba(255,77,106,.25);color:#ff4d6a',
  };
  el.style.cssText = `display:block;margin-bottom:10px;padding:9px 12px;border-radius:8px;font-size:13px;line-height:1.5;background:${colors[type]}`;
  el.textContent = msg;
}
function hideStatus() { const el = document.getElementById('scrape-status'); if (el) el.style.display = 'none'; }

// ── Update Price ──────────────────────────────────────────────
function openUpdatePrice(id) {
  document.getElementById('update-price-pid').value = id;
  document.getElementById('update-price-val').value = '';
  openModal('modal-update-price');
  setTimeout(() => document.getElementById('update-price-val')?.focus(), 200);
}
async function submitUpdatePrice() {
  const pid   = document.getElementById('update-price-pid').value;
  const price = parseFloat(document.getElementById('update-price-val').value);
  if (!price || isNaN(price)) return toast('Enter a valid price.', 'error');

  // Disable button while saving
  const saveBtn = document.querySelector('#modal-update-price .btn-primary');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

  try {
    const r = await API.updatePrice(pid, price);
    closeModal('modal-update-price');

    // Show toast immediately
    if (r.alerts_triggered > 0) {
      toast('🎯 Target hit! Price alert created. Gmail sending in background...', 'success');
    } else {
      toast(`✓ Price updated to ₹${Number(price).toLocaleString('en-IN')}`, 'success');
    }

    // Refresh badge
    refreshAlertBadge();

    // IMMEDIATELY reload the product detail page so new price shows
    const onDetail    = document.getElementById('page-detail')?.classList.contains('active');
    const onProducts  = document.getElementById('page-products')?.classList.contains('active');
    const onDashboard = document.getElementById('page-dashboard')?.classList.contains('active');

    if (onDetail)    { await loadDetail(parseInt(pid)); }
    else if (onProducts)  { await loadProducts(); }
    else if (onDashboard) { await loadDashboard(); }
    else { loadProducts(); }

  } catch(e) {
    toast(e.message || 'Failed to update price.', 'error');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save & Check Alert'; }
  }
}

// ── Watchlist Actions ─────────────────────────────────────────
async function addToWatchlist(pid) {
  const t = parseFloat(document.getElementById(`watch-target-${pid}`)?.value);
  if (!t) return toast('Enter a target price.', 'error');
  try { await API.addToWatchlist(pid, t); toast('🎯 Watching! Gmail alert will fire automatically.', 'success'); loadDetail(pid); }
  catch(e) { toast(e.message, 'error'); }
}
async function removeFromWatchlist(wid) {
  try {
    await API.removeWatch(wid);
    toast('Removed from watchlist.', 'info');
    if (document.getElementById('page-watchlist').classList.contains('active')) loadWatchlist();
    if (document.getElementById('page-detail').classList.contains('active') && currentDetailId) loadDetail(currentDetailId);
    loadDashboard();
  } catch(e) { toast(e.message, 'error'); }
}
async function deleteProduct(id) {
  if (!confirm('Remove this product and all its price history?')) return;
  try { await API.deleteProduct(id); toast('Product removed.', 'info'); navigate('products'); }
  catch(e) { toast(e.message, 'error'); }
}

// ── Modals ────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(m =>
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); }));

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const wrap = document.getElementById('toast-wrap');
  const el   = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${{success:'✓',error:'✕',info:'ℹ'}[type]||'ℹ'}</span><span>${msg}</span>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// ── Format ────────────────────────────────────────────────────
function fmt(n) {
  return Number(n).toLocaleString('en-IN', {minimumFractionDigits:0, maximumFractionDigits:2});
}

// ══════════════════════════════════════════════════════════════
// AI SHOPPING ASSISTANT — Chat Interface
// ══════════════════════════════════════════════════════════════
let chatOpen      = false;
let aiTyping      = false;
let currentProdId = null; // set when on a product detail page

// ── Show chat bubble after login ──────────────────────────────
const _origLoginSuccess = loginSuccess;
// Patch loginSuccess to also show bubble
const origLoginSuccessRef = window.loginSuccess;

function showAIBubble()  { const el = document.getElementById('ai-chat-bubble'); if (el) el.style.display = 'block'; }
function hideAIBubble()  { const el = document.getElementById('ai-chat-bubble'); if (el) el.style.display = 'none'; }

// Hook into loginSuccess to show bubble
const _loginSuccess = loginSuccess;
window.addEventListener('load', () => {
  // If user is already logged in (page refresh), bubble shows via bootstrap
});

// Called from loginSuccess — bubble appears after login
function onAfterLogin() { showAIBubble(); }

// Override loginSuccess to show bubble
const __loginSuccess = loginSuccess;
window.loginSuccess  = function(user, redirect = true) {
  __loginSuccess(user, redirect);
  showAIBubble();
};

// ── Toggle chat window ────────────────────────────────────────
function toggleChat() {
  chatOpen = !chatOpen;
  const win  = document.getElementById('ai-chat-window');
  const icon = document.querySelector('.ai-bubble-icon');
  if (chatOpen) {
    win.style.display = 'flex';
    document.getElementById('ai-input')?.focus();
    if (icon) icon.textContent = '✕';
    scrollChatBottom();
  } else {
    win.style.display = 'none';
    if (icon) icon.textContent = '🤖';
  }
}

// ── Send suggestion chip ──────────────────────────────────────
function sendSuggestion(btn) {
  document.getElementById('ai-input').value = btn.textContent;
  sendAIMessage();
}

// ── Send message ──────────────────────────────────────────────
async function sendAIMessage() {
  const input   = document.getElementById('ai-input');
  const message = input?.value?.trim();
  if (!message || aiTyping) return;

  input.value = '';

  // Hide suggestions after first message
  const suggestions = document.getElementById('ai-suggestions');
  if (suggestions) suggestions.style.display = 'none';

  // Show user message
  appendMessage(message, 'user');

  // Show typing indicator
  showTyping();
  aiTyping = true;
  document.getElementById('ai-send-btn').disabled = true;

  try {
    const body = { message };
    // Pass current product_id if on detail page
    if (currentDetailId) body.product_id = currentDetailId;

    const res  = await fetch('/api/ai-chat', {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify(body),
    });
    const data = await res.json();

    hideTyping();

    if (data.error && !data.reply) {
      appendMessage('Sorry, I ran into an error. Please try again.', 'bot');
    } else {
      appendMessage(data.reply, 'bot', data);
    }

  } catch(e) {
    hideTyping();
    appendMessage('Connection error. Please check your internet and try again.', 'bot');
  } finally {
    aiTyping = false;
    document.getElementById('ai-send-btn').disabled = false;
    input?.focus();
  }
}

// ── Append message to chat ────────────────────────────────────
function appendMessage(text, sender, data = null) {
  const messages = document.getElementById('ai-messages');
  if (!messages) return;

  const wrap = document.createElement('div');
  wrap.className = `ai-msg ai-msg-${sender === 'user' ? 'user' : 'bot'}`;

  const time  = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });

  // Convert markdown-like formatting to HTML
  const formatted = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');

  wrap.innerHTML = `
    <div class="ai-msg-bubble">${formatted}</div>
    <div class="ai-msg-time">${time}</div>
  `;

  // Add comparison card if structured data available
  if (data?.structured?.comparison && sender === 'bot') {
    const compCard = buildComparisonCard(data.structured.comparison);
    if (compCard) {
      const bubble = wrap.querySelector('.ai-msg-bubble');
      bubble?.insertAdjacentHTML('afterend', compCard);
    }
  }

  messages.appendChild(wrap);
  scrollChatBottom();
}

// ── Comparison Card ───────────────────────────────────────────
function buildComparisonCard(comparison) {
  if (!comparison?.length) return '';
  const rows = comparison.map(p => `
    <div class="ai-comparison-row">
      <span style="color:var(--text);font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.product}</span>
      <span style="color:var(--accent);font-family:var(--font-m);flex-shrink:0;margin-left:8px">₹${p.current_price ? Math.round(p.current_price).toLocaleString('en-IN') : 'N/A'}</span>
      <span style="color:var(--green);font-size:10px;margin-left:8px;flex-shrink:0">↓${p.price_drop_pct}%</span>
    </div>
  `).join('');
  return `<div class="ai-comparison-card">${rows}</div>`;
}

// ── Typing indicator ──────────────────────────────────────────
function showTyping() {
  const messages = document.getElementById('ai-messages');
  if (!messages) return;
  const el = document.createElement('div');
  el.className = 'ai-msg ai-msg-bot';
  el.id = 'ai-typing-indicator';
  el.innerHTML = `<div class="ai-msg-bubble" style="padding:10px 14px">
    <div class="ai-typing"><span></span><span></span><span></span></div>
  </div>`;
  messages.appendChild(el);
  scrollChatBottom();
}
function hideTyping() {
  document.getElementById('ai-typing-indicator')?.remove();
}

function scrollChatBottom() {
  const messages = document.getElementById('ai-messages');
  if (messages) setTimeout(() => { messages.scrollTop = messages.scrollHeight; }, 50);
}

// ── Clear chat ────────────────────────────────────────────────
async function clearChat() {
  try {
    await fetch('/api/ai-chat/clear', { method:'DELETE', credentials:'include' });
  } catch {}
  const messages = document.getElementById('ai-messages');
  if (messages) messages.innerHTML = `
    <div class="ai-msg ai-msg-bot">
      <div class="ai-msg-bubble">Chat cleared! How can I help you with your shopping decisions? 🛍️</div>
    </div>`;
  const suggestions = document.getElementById('ai-suggestions');
  if (suggestions) suggestions.style.display = 'flex';
}

// ── Update status when AI is typing ──────────────────────────
const _origSendAIMessage = sendAIMessage;