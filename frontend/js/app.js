// ── PriceWatch v2 App ─────────────────────────────────────────
let currentUser = null;
let priceChart  = null;
let allProducts = [];
let notifyPref  = true;
let fetchTimer  = null;

const PAGE_LABELS = {
  dashboard:'Dashboard', products:'My Products', detail:'Product Detail',
  watchlist:'Watchlist', alerts:'Alerts', profile:'Settings', endpoints:'API Endpoints',
};

// ── Bootstrap ─────────────────────────────────────────────────
(async () => {
  try { const { user } = await API.me(); loginSuccess(user); }
  catch { showAuth(); }
})();

function showAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function loginSuccess(user) {
  currentUser = user;
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  ['sidebar-name','profile-name'].forEach(id => { const el = document.getElementById(id); if(el) el.textContent = user.name; });
  ['sidebar-email','profile-email'].forEach(id => { const el = document.getElementById(id); if(el) el.textContent = user.email; });
  ['sidebar-avatar','profile-avatar'].forEach(id => { const el = document.getElementById(id); if(el) el.textContent = user.name[0].toUpperCase(); });
  navigate('dashboard');
  refreshAlertBadge();
}

// ── Auth ──────────────────────────────────────────────────────
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t,i) =>
    t.classList.toggle('active', (i===0&&tab==='login')||(i===1&&tab==='register')));
  document.getElementById('form-login').classList.toggle('active', tab==='login');
  document.getElementById('form-register').classList.toggle('active', tab==='register');
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-password').value;
  if (!email||!pass) return toast('Enter email and password.','error');
  try { const { user } = await API.login(email, pass); loginSuccess(user); toast(`Welcome back, ${user.name}! 👋`,'success'); }
  catch(e) { toast(e.message,'error'); }
}

async function handleRegister() {
  const name  = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass  = document.getElementById('reg-password').value;
  if (!name||!email||!pass) return toast('All fields required.','error');
  if (pass.length < 6) return toast('Password must be 6+ characters.','error');
  try { const { user } = await API.register(name, email, pass); loginSuccess(user); toast('Account created! Welcome 🎉','success'); }
  catch(e) { toast(e.message,'error'); }
}

async function handleLogout() {
  await API.logout(); currentUser = null;
  if (priceChart) { priceChart.destroy(); priceChart = null; }
  showAuth();
}

// ── Navigation ────────────────────────────────────────────────
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item,.topnav-btn').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.bnav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  // Map page to nav key
  const keyMap = { dashboard:'dashboard', products:'products', detail:'products',
                   watchlist:'watchlist', alerts:'alerts', profile:'profile', endpoints:'endpoints' };
  const key = keyMap[page] || page;
  document.getElementById(`snav-${key}`)?.classList.add('active');
  document.getElementById(`tnav-${key}`)?.classList.add('active');
  document.getElementById(`bnav-${key}`)?.classList.add('active');

  const bc = document.getElementById('bc-page');
  if (bc) bc.textContent = PAGE_LABELS[page] || page;

  closeSidebar();
  if (page==='dashboard') loadDashboard();
  if (page==='products')  loadProducts();
  if (page==='watchlist') loadWatchlist();
  if (page==='alerts')    loadAlerts();
  if (page==='profile')   loadProfile();
  if (page==='endpoints') renderEndpoints();
}

// ── Sidebar (mobile) ──────────────────────────────────────────
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
    const [statsData, { watchlist }] = await Promise.all([API.getStats(), API.getWatchlist()]);
    const { total_products, watching, total_alerts, unread, best_deals } = statsData;
    document.getElementById('stat-products').textContent = total_products;
    document.getElementById('stat-watching').textContent = watching;
    document.getElementById('stat-alerts').textContent   = total_alerts;
    document.getElementById('stat-unread').textContent   = unread;

    const sec = document.getElementById('best-deals-section');
    if (best_deals?.length) {
      sec.style.display = 'block';
      document.getElementById('best-deals-list').innerHTML = best_deals.map(d => {
        const drop = d.first_price > 0 ? ((d.first_price - d.current_price)/d.first_price*100).toFixed(1) : 0;
        return `<div class="alert-item" style="border-left-color:var(--green);cursor:pointer" onclick="loadDetail(${d.product_id})">
          <div class="alert-icon">🏆</div>
          <div class="alert-body"><div class="alert-title">${d.name}</div><div class="alert-meta">${d.category} · ↓${drop}% from ₹${fmt(d.first_price)}</div></div>
          <div class="alert-price">₹${fmt(d.current_price)}</div>
        </div>`;
      }).join('');
    } else { sec.style.display = 'none'; }

    const cont = document.getElementById('dashboard-watchlist');
    if (!watchlist.length) {
      cont.innerHTML = `<div class="empty-state"><div class="ei">👁️</div><h3>Watchlist empty</h3><p>Add a product and set a target price.</p><button class="btn btn-primary" style="margin-top:12px" onclick="openAddProduct()">+ Add Product</button></div>`;
    } else {
      cont.innerHTML = `<div class="watch-table-wrap">${buildWatchTable(watchlist.slice(0,6))}</div>`;
    }
  } catch(e) { console.error(e); toast('Dashboard load failed.','error'); }
}

// ── Products ──────────────────────────────────────────────────
async function loadProducts() {
  const grid = document.getElementById('products-grid');
  grid.innerHTML = '<div class="spinner"></div>';
  try {
    const { products } = await API.getProducts();
    allProducts = products;
    renderProductGrid(products);
  } catch(e) { toast('Failed to load products.','error'); }
}

function filterProducts(q) {
  const low = q.toLowerCase();
  renderProductGrid(allProducts.filter(p =>
    p.name.toLowerCase().includes(low) || p.category.toLowerCase().includes(low)));
}

function renderProductGrid(products) {
  const grid = document.getElementById('products-grid');
  if (!products.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="ei">🛍️</div><h3>No products yet</h3><p>Click "+ Add Product" to start tracking.</p><button class="btn btn-primary" style="margin-top:12px" onclick="openAddProduct()">+ Add Product</button></div>`;
    return;
  }
  grid.innerHTML = products.map(p => {
    const drop = p.first_price && p.current_price && p.first_price > p.current_price
      ? ((p.first_price - p.current_price)/p.first_price*100).toFixed(1) : null;
    return `<div class="product-card" onclick="loadDetail(${p.product_id})">
      ${p.image_url ? `<img class="product-img" src="${p.image_url}" alt="${p.name}" onerror="this.style.display='none'">` : `<div class="product-img-ph">🛍️</div>`}
      <div class="product-body">
        <div class="product-cat">${p.category}</div>
        <div class="product-name">${p.name}</div>
        <div class="price-row">
          <span class="price-current">${p.current_price ? '₹'+fmt(p.current_price) : 'Not fetched'}</span>
          ${p.all_time_low ? `<span class="price-atl">${fmt(p.all_time_low)}</span>` : ''}
          ${drop ? `<span class="drop-pill drop-down">↓${drop}%</span>` : ''}
        </div>
        <div class="last-checked">🤖 ${p.price_entries||0} snapshot${p.price_entries!==1?'s':''}</div>
        <div class="product-actions" onclick="event.stopPropagation()">
          <button class="btn btn-outline btn-sm" onclick="loadDetail(${p.product_id})">📈</button>
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
    const cur   = prices.length ? prices[prices.length-1] : 0;
    const atl   = prices.length ? Math.min(...prices) : 0;
    const first = prices.length ? prices[0] : 0;
    const drop  = first > 0 ? ((first-cur)/first*100).toFixed(1) : 0;

    document.getElementById('detail-content').innerHTML = `
      <div class="detail-header">
        ${product.image_url ? `<img class="detail-img" src="${product.image_url}" alt="${product.name}">` : `<div class="detail-img" style="background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:26px">🛍️</div>`}
        <div class="detail-meta">
          <span class="tag">${product.category}</span>
          <div class="detail-name" style="margin-top:7px">${product.name}</div>
          <div class="detail-prices">
            <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px">Current</div><div class="price-big">₹${fmt(cur)}</div></div>
            <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px">All-Time Low</div><div class="price-big" style="color:var(--green)">₹${fmt(atl)}</div></div>
            <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px">Total Drop</div><div class="price-big" style="color:${drop>0?'var(--green)':'var(--muted)'}">↓${drop}%</div></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" onclick="openUpdatePrice(${product.product_id})">✏️ Update Price</button>
            <a class="btn btn-outline btn-sm" href="${product.url}" target="_blank">🔗 Open</a>
            <button class="btn btn-danger btn-sm" onclick="deleteProduct(${product.product_id})">🗑 Remove</button>
          </div>
        </div>
      </div>
      <div class="chart-card">
        <div class="chart-header"><div class="chart-title">📈 Price History</div><span style="font-size:12px;color:var(--muted)">${history.length} points</span></div>
        <canvas id="price-chart" height="90"></canvas>
      </div>
      <div class="section-title">👁️ Watch Target</div>
      ${watchInfo
        ? `<div class="alert-item" style="margin-bottom:16px">
            <div class="alert-icon">🎯</div>
            <div class="alert-body"><div class="alert-title">Target: ₹${fmt(watchInfo.target_price)}</div><div class="alert-meta">Current ₹${fmt(watchInfo.current_price||cur)} · ATL ₹${fmt(watchInfo.all_time_low||atl)}</div></div>
            ${(watchInfo.current_price||cur) <= watchInfo.target_price ? `<span class="drop-pill drop-down">✓ Hit!</span>` : ''}
            <button class="btn btn-danger btn-sm" onclick="removeFromWatchlist(${watchInfo.watch_id})">Remove</button>
           </div>`
        : `<div style="margin-bottom:16px">
            <p style="color:var(--muted);font-size:13px;margin-bottom:10px">Set a target — get alerted when it drops that low.</p>
            <div style="display:flex;gap:8px"><input type="number" id="watch-target-${id}" placeholder="Target price ₹" style="flex:1"/><button class="btn btn-primary" onclick="addToWatchlist(${id})">🎯 Watch</button></div>
           </div>`}
    `;
    renderPriceChart(history, watchInfo?.target_price);
    // Load AI prediction after chart
    loadPrediction(id);
  } catch(e) { toast('Failed to load product.','error'); }
}

function renderPriceChart(history, target) {
  if (priceChart) { priceChart.destroy(); priceChart = null; }
  const ctx = document.getElementById('price-chart');
  if (!ctx || !history.length) return;
  const labels  = history.map(h => new Date(h.recorded_at).toLocaleDateString('en-IN',{month:'short',day:'numeric'}));
  const prices  = history.map(h => parseFloat(h.price));
  const datasets = [{
    label:'Price', data:prices, borderColor:'#f5a623', backgroundColor:'rgba(245,166,35,.07)',
    borderWidth:2, pointRadius:4, pointBackgroundColor:'#f5a623', pointBorderColor:'#0c0e13',
    pointBorderWidth:2, tension:.35, fill:true,
  }];
  if (target) datasets.push({ label:'Target', data:Array(labels.length).fill(+target), borderColor:'#27d872', borderDash:[5,4], borderWidth:1.5, pointRadius:0, fill:false });
  priceChart = new Chart(ctx, {
    type:'line', data:{ labels, datasets },
    options:{
      responsive:true,
      plugins:{
        legend:{ labels:{ color:'#7c82a0', font:{ family:'DM Mono', size:11 } } },
        tooltip:{ backgroundColor:'#1e2230', borderColor:'#2c3045', borderWidth:1, titleColor:'#eef0f6', bodyColor:'#7c82a0', callbacks:{ label:ctx => ` ₹${fmt(ctx.raw)}` } },
      },
      scales:{
        x:{ grid:{ color:'rgba(255,255,255,.04)' }, ticks:{ color:'#7c82a0', font:{ size:10 } } },
        y:{ grid:{ color:'rgba(255,255,255,.04)' }, ticks:{ color:'#7c82a0', font:{ size:10 }, callback:v => '₹'+fmt(v) } },
      },
    },
  });
}

// ── AI Prediction ─────────────────────────────────────────────
async function loadPrediction(productId) {
  const card = document.getElementById('ai-prediction-card');
  const body = document.getElementById('ai-prediction-body');
  if (!card || !body) return;

  card.style.display = 'block';
  body.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:10px 0">
    <div class="spinner" style="width:22px;height:22px;margin:0"></div>
    <span style="font-size:13px;color:var(--muted)">AI is analysing price trends...</span>
  </div>`;

  try {
    const data = await API.predict(productId);

    if (data.error && !data.prediction?.length) {
      body.innerHTML = `<div style="padding:10px 0;font-size:13px;color:var(--muted)">
        ⚠️ ${data.error}
      </div>`;
      return;
    }

    const trendColor = data.trend === 'falling' ? 'var(--green)' : data.trend === 'rising' ? 'var(--red)' : 'var(--accent)';
    const trendIcon  = data.trend === 'falling' ? '📉' : data.trend === 'rising' ? '📈' : '➡️';
    const confColor  = data.confidence >= 70 ? 'var(--green)' : data.confidence >= 40 ? 'var(--accent)' : 'var(--red)';

    body.innerHTML = `
      <!-- Insight Banner -->
      <div style="background:rgba(245,166,35,.07);border:1px solid rgba(245,166,35,.15);border-radius:10px;padding:14px 16px;margin-bottom:14px">
        <div style="font-size:14px;font-weight:600;color:var(--text);line-height:1.5">${data.insight}</div>
      </div>

      <!-- Stats Row -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:9px;padding:11px 12px;text-align:center">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">Trend</div>
          <div style="font-size:18px">${trendIcon}</div>
          <div style="font-size:11px;font-weight:600;color:${trendColor};margin-top:2px">${data.trend?.toUpperCase()}</div>
        </div>
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:9px;padding:11px 12px;text-align:center">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">Lowest in 7d</div>
          <div style="font-size:15px;font-weight:600;color:var(--green);font-family:var(--font-m)">₹${fmt(data.min_predicted)}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">${data.best_buy_day || ''}</div>
        </div>
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:9px;padding:11px 12px;text-align:center">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">Confidence</div>
          <div style="font-size:15px;font-weight:600;color:${confColor};font-family:var(--font-m)">${data.confidence}%</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">${data.data_points} data pts</div>
        </div>
      </div>

      <!-- 7-day prediction table -->
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:8px">7-Day Forecast</div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">
        ${data.prediction.map((p, i) => {
          const isMin   = p.price === data.min_predicted;
          const dayName = new Date(p.date).toLocaleDateString('en-IN', { weekday: 'short' });
          const dayNum  = new Date(p.date).getDate();
          return `<div style="background:${isMin ? 'rgba(39,216,114,.1)' : 'var(--bg3)'};border:1px solid ${isMin ? 'rgba(39,216,114,.3)' : 'var(--border)'};border-radius:8px;padding:7px 4px;text-align:center">
            <div style="font-size:9px;color:var(--muted)">${dayName}</div>
            <div style="font-size:9px;color:var(--muted)">${dayNum}</div>
            <div style="font-size:10px;font-weight:600;color:${isMin ? 'var(--green)' : 'var(--text)'};font-family:var(--font-m);margin-top:3px">₹${Math.round(p.price/100)*100 > 999 ? (p.price/1000).toFixed(1)+'k' : Math.round(p.price)}</div>
            ${isMin ? '<div style="font-size:8px;color:var(--green);margin-top:2px">BEST</div>' : ''}
          </div>`;
        }).join('')}
      </div>

      ${data.drop_detected ? `<div style="margin-top:10px;padding:8px 12px;background:rgba(255,77,106,.08);border:1px solid rgba(255,77,106,.2);border-radius:8px;font-size:12px;color:var(--red)">🚨 Sudden price drop detected in the forecast window</div>` : ''}
      <div style="margin-top:8px;font-size:10px;color:var(--muted)">
        Model: ${data.method || 'Polynomial Regression'} · R² ${data.r2_score} · ${data.from_cache ? 'Cached result' : 'Fresh prediction'}
      </div>
    `;

    // Update chart with prediction overlay
    renderPriceChart(
      null, null,
      { history: data.history, prediction: data.prediction, target: null }
    );

  } catch(e) {
    body.innerHTML = `<div style="padding:10px 0;font-size:13px;color:var(--muted)">Failed to load prediction. Try again later.</div>`;
  }
}

// ── Watchlist ─────────────────────────────────────────────────
async function loadWatchlist() {
  const cont = document.getElementById('watchlist-content');
  cont.innerHTML = '<div class="spinner"></div>';
  try {
    const { watchlist } = await API.getWatchlist();
    if (!watchlist.length) {
      cont.innerHTML = `<div class="empty-state"><div class="ei">👁️</div><h3>Watchlist empty</h3><p>Open any product and set a target price.</p></div>`;
      return;
    }
    cont.innerHTML = `<div class="watch-table-wrap">${buildWatchTable(watchlist)}</div>`;
  } catch(e) { toast('Failed to load watchlist.','error'); }
}

function buildWatchTable(list) {
  const rows = list.map(w => {
    const drop = w.drop_pct;
    const dropEl = drop > 0 ? `<span class="drop-pill drop-down">↓${drop}%</span>`
      : drop < 0 ? `<span class="drop-pill drop-up">↑${Math.abs(drop)}%</span>`
      : `<span style="color:var(--muted);font-size:11px">—</span>`;
    const hit = w.current_price && w.current_price <= w.target_price;
    return `<tr>
      <td style="cursor:pointer" onclick="loadDetail(${w.product_id})">
        <div style="font-weight:600;font-size:13px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${w.name}</div>
        <div style="font-size:11px;color:var(--muted)">${w.category}</div>
      </td>
      <td class="price-mono">${w.current_price ? '₹'+fmt(w.current_price) : '—'}</td>
      <td class="price-mono" style="color:var(--accent)">₹${fmt(w.target_price)}</td>
      <td class="price-mono" style="color:var(--green)">${w.all_time_low ? '₹'+fmt(w.all_time_low) : '—'}</td>
      <td>${dropEl}</td>
      <td>${hit ? '<span class="drop-pill drop-down">✓ Hit!</span>' : '<span style="color:var(--green);font-size:11px">🤖 Watching</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-outline btn-sm" onclick="loadDetail(${w.product_id})">Chart</button>
        <button class="btn btn-danger btn-sm" style="margin-left:4px" onclick="removeFromWatchlist(${w.watch_id})">✕</button>
      </td>
    </tr>`;
  }).join('');
  return `<table class="watch-table">
    <thead><tr><th>Product</th><th>Current</th><th>Target</th><th>ATL</th><th>Drop</th><th>Status</th><th></th></tr></thead>
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
      list.innerHTML = `<div class="empty-state"><div class="ei">🔔</div><h3>No alerts yet</h3><p>Alerts appear when a product price hits your target automatically.</p></div>`;
      return;
    }
    list.innerHTML = alerts.map(a => `
      <div class="alert-item ${a.is_read?'read':''}">
        <div class="alert-icon">🎯</div>
        <div class="alert-body">
          <div class="alert-title">${a.product_name} hit target!${a.email_sent ? '<span class="email-badge">📧 Sent</span>' : ''}</div>
          <div class="alert-meta">Target ₹${fmt(a.target_price)} · ${new Date(a.triggered_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div>
        </div>
        <div class="alert-price">₹${fmt(a.triggered_price)}</div>
      </div>`).join('');
    refreshAlertBadge();
  } catch(e) { toast('Failed to load alerts.','error'); }
}

async function markAllRead() {
  try { await API.markAllRead(); toast('All marked read.','success'); loadAlerts(); refreshAlertBadge(); }
  catch(e) { toast(e.message,'error'); }
}

async function refreshAlertBadge() {
  try {
    const { unread_count } = await API.getAlerts();
    ['alert-badge','bnav-badge'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.style.display = unread_count > 0 ? 'inline-flex' : 'none'; el.textContent = unread_count; }
    });
    const dot = document.getElementById('topnav-dot');
    if (dot) dot.style.display = unread_count > 0 ? 'block' : 'none';
  } catch {}
}

// ── Profile ───────────────────────────────────────────────────
function loadProfile() {
  document.getElementById('email-toggle')?.classList.toggle('on', notifyPref);
}
async function toggleEmailNotif() {
  notifyPref = !document.getElementById('email-toggle').classList.contains('on');
  document.getElementById('email-toggle').classList.toggle('on', notifyPref);
  try { await API.setNotif(notifyPref); toast(notifyPref ? '📧 Gmail alerts on' : 'Gmail alerts off','info'); }
  catch(e) { toast(e.message,'error'); }
}

// ── Add Product ───────────────────────────────────────────────
function openAddProduct() {
  ['add-url','add-name','add-image','add-price','add-target'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const btn = document.getElementById('fetch-btn');
  if (btn) { btn.textContent = '🔍'; btn.disabled = false; }
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
  if (!name||!url||!price) return toast('Name, URL and price required.','error');
  try {
    const { product_id } = await API.addProduct({ name, url, category:cat, image_url:img, initial_price:price });
    if (tgt) await API.addToWatchlist(product_id, tgt);
    closeModal('modal-add-product');
    toast(`${name} is now tracked! 🤖`,'success');
    loadProducts();
  } catch(e) { toast(e.message,'error'); }
}

// ── Scraper UI ────────────────────────────────────────────────
function onUrlInput(val) {
  clearTimeout(fetchTimer);
  if (!val.trim()) { hideStatus(); hideScrapePreview(); return; }
  if (val.startsWith('http')) fetchTimer = setTimeout(fetchFromUrl, 1400);
}

async function fetchFromUrl() {
  const url = document.getElementById('add-url').value.trim();
  if (!url) return toast('Paste a product URL first.','error');
  const btn = document.getElementById('fetch-btn');
  btn.textContent = '⏳'; btn.disabled = true;
  hideScrapePreview();
  showStatus('Fetching price — up to 20 seconds…','loading');
  try {
    const r = await API.scrapeUrl(url);
    if (r.success && r.price) {
      if (r.name)  document.getElementById('add-name').value  = r.name;
      if (r.image) document.getElementById('add-image').value = r.image;
      document.getElementById('add-price').value = r.price;
      showScrapePreview(r);
      showStatus(`Price found: ₹${fmt(r.price)} — fill the form and click Start Tracking.`,'success');
    } else {
      if (r.name)  document.getElementById('add-name').value  = r.name;
      if (r.image) document.getElementById('add-image').value = r.image;
      if (r.name||r.image) showScrapePreview(r);
      showStatus(r.error||'Price not detected. Enter manually.','warning');
    }
  } catch(e) { showStatus('Fetch failed. Enter details manually.','error'); }
  finally { btn.textContent = '🔄'; btn.disabled = false; }
}

function showScrapePreview(r) {
  const el = document.getElementById('scrape-preview');
  document.getElementById('preview-img').src   = r.image || '';
  document.getElementById('preview-img').style.display = r.image ? 'block' : 'none';
  document.getElementById('preview-name').textContent  = r.name  || 'Name not detected';
  document.getElementById('preview-price').textContent = r.price ? `₹${fmt(r.price)}` : 'Price not detected';
  el.style.display = 'flex';
}
function hideScrapePreview() { const el = document.getElementById('scrape-preview'); if (el) el.style.display = 'none'; }
function showStatus(msg, type) {
  const el = document.getElementById('scrape-status'); if (!el) return;
  const s = { loading:'background:rgba(74,158,255,.08);border:1px solid rgba(74,158,255,.25);color:#4a9eff', success:'background:rgba(39,216,114,.08);border:1px solid rgba(39,216,114,.25);color:#27d872', warning:'background:rgba(245,166,35,.08);border:1px solid rgba(245,166,35,.25);color:#f5a623', error:'background:rgba(255,77,106,.08);border:1px solid rgba(255,77,106,.25);color:#ff4d6a' };
  el.style.cssText = `display:block;margin-bottom:12px;padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.5;${s[type]}`;
  el.innerHTML = `${{loading:'⏳',success:'✓',warning:'⚠',error:'✕'}[type]} ${msg}`;
}
function hideStatus() { const el = document.getElementById('scrape-status'); if (el) el.style.display = 'none'; }

// ── Update Price ──────────────────────────────────────────────
function openUpdatePrice(id) {
  document.getElementById('update-price-pid').value = id;
  document.getElementById('update-price-val').value = '';
  openModal('modal-update-price');
  setTimeout(() => document.getElementById('update-price-val').focus(), 200);
}
async function submitUpdatePrice() {
  const pid   = document.getElementById('update-price-pid').value;
  const price = parseFloat(document.getElementById('update-price-val').value);
  if (!price) return toast('Enter a valid price.','error');
  try {
    const r = await API.updatePrice(pid, price);
    closeModal('modal-update-price');
    toast(r.alerts_triggered > 0 && r.emails_dispatched > 0 ? `Target hit! 📧 Gmail sent!` : r.alerts_triggered > 0 ? `Target hit! Alert created.` : 'Price updated.', r.alerts_triggered > 0 ? 'success' : 'info');
    refreshAlertBadge();
    if (document.getElementById('page-detail').classList.contains('active')) loadDetail(pid);
    else loadProducts();
  } catch(e) { toast(e.message,'error'); }
}

// ── Watchlist Actions ─────────────────────────────────────────
async function addToWatchlist(pid) {
  const t = parseFloat(document.getElementById(`watch-target-${pid}`)?.value);
  if (!t) return toast('Enter a target price.','error');
  try { await API.addToWatchlist(pid, t); toast('Watching! 🎯 Gmail alert when price drops.','success'); loadDetail(pid); }
  catch(e) { toast(e.message,'error'); }
}
async function removeFromWatchlist(wid) {
  try {
    await API.removeWatch(wid); toast('Removed from watchlist.','info');
    if (document.getElementById('page-watchlist').classList.contains('active')) loadWatchlist();
    else if (document.getElementById('page-detail').classList.contains('active')) {
      const pid = document.getElementById('update-price-pid').value; if(pid) loadDetail(pid);
    }
    loadDashboard();
  } catch(e) { toast(e.message,'error'); }
}
async function deleteProduct(id) {
  if (!confirm('Remove this product and all its price history?')) return;
  try { await API.deleteProduct(id); toast('Product removed.','info'); navigate('products'); }
  catch(e) { toast(e.message,'error'); }
}

// ── Modals ────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(m =>
  m.addEventListener('click', e => { if (e.target===m) m.classList.remove('open'); }));

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type='info') {
  const wrap = document.getElementById('toast-wrap');
  const el   = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${{success:'✓',error:'✕',info:'ℹ'}[type]||'ℹ'}</span><span>${msg}</span>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ── Format ────────────────────────────────────────────────────
function fmt(n) {
  return Number(n).toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:2});
}

// ── API Endpoints Page ────────────────────────────────────────
const ENDPOINTS = [
  { section:'🔐 Authentication', items:[
    { method:'POST', path:'/auth/register', auth:false, desc:'Create account', body:'{ name, email, password }', response:'{ message, user: { user_id, name, email } }', note:'Password hashed with bcrypt 10 rounds before storing in database.' },
    { method:'POST', path:'/auth/login',    auth:false, desc:'Log in', body:'{ email, password }', response:'{ message, user }', note:'Uses session.regenerate() to prevent session fixation attacks.' },
    { method:'POST', path:'/auth/logout',   auth:true,  desc:'Log out', body:'none', response:'{ message }', note:'' },
    { method:'GET',  path:'/auth/me',       auth:true,  desc:'Get current user', body:'none', response:'{ user }', note:'Called on page load to check if session is still active.' },
    { method:'PUT',  path:'/auth/notifications', auth:true, desc:'Toggle Gmail alerts', body:'{ notify_email: boolean }', response:'{ message }', note:'' },
  ]},
  { section:'🛍️ Products', items:[
    { method:'GET',    path:'/products',           auth:true, desc:'List all products + price stats', body:'none', response:'{ products: [...] }', note:'Uses correlated subqueries to get current_price, first_price, and all_time_low per product.' },
    { method:'GET',    path:'/products/:id',        auth:true, desc:'Product + full price history', body:'none', response:'{ product, history, watchInfo }', note:'history array powers the Chart.js price graph.' },
    { method:'POST',   path:'/products',            auth:true, desc:'Add product', body:'{ name, url, category, image_url, initial_price }', response:'{ message, product_id }', note:'Uses RETURNING product_id (PostgreSQL syntax).' },
    { method:'POST',   path:'/products/:id/price',  auth:true, desc:'Update price → checks alerts → sends Gmail', body:'{ price: number }', response:'{ message, alerts_triggered, emails_dispatched }', note:'checkAndCreateAlerts() replaces the SQL trigger. Sends Gmail if price hits target.' },
    { method:'PUT',    path:'/products/:id',        auth:true, desc:'Edit product info', body:'{ name, category, image_url }', response:'{ message }', note:'' },
    { method:'DELETE', path:'/products/:id',        auth:true, desc:'Delete product (cascade)', body:'none', response:'{ message }', note:'ON DELETE CASCADE removes all price_history, watchlist entries, and alerts.' },
  ]},
  { section:'👁️ Watchlist', items:[
    { method:'GET',    path:'/watchlist',    auth:true, desc:'All watched products with drop %', body:'none', response:'{ watchlist: [...] }', note:'drop_pct calculated as (first_price - current_price) / first_price × 100 in SQL.' },
    { method:'POST',   path:'/watchlist',    auth:true, desc:'Add to watchlist', body:'{ product_id, target_price }', response:'{ message }', note:'Uses PostgreSQL ON CONFLICT (user_id, product_id) DO UPDATE SET — safe to call multiple times.' },
    { method:'PUT',    path:'/watchlist/:id', auth:true, desc:'Update target price', body:'{ target_price }', response:'{ message }', note:'' },
    { method:'DELETE', path:'/watchlist/:id', auth:true, desc:'Remove from watchlist', body:'none', response:'{ message }', note:'' },
  ]},
  { section:'🔔 Alerts', items:[
    { method:'GET', path:'/alerts',       auth:true, desc:'All alerts with unread count', body:'none', response:'{ alerts: [...], unread_count }', note:'email_sent shows whether Gmail was successfully dispatched.' },
    { method:'PUT', path:'/alerts/read-all', auth:true, desc:'Mark all as read', body:'none', response:'{ message }', note:'Uses subquery: UPDATE alerts WHERE watch_id IN (SELECT ... FROM watchlist WHERE user_id = ?)' },
    { method:'GET', path:'/alerts/stats', auth:true, desc:'Dashboard stats', body:'none', response:'{ total_products, watching, total_alerts, unread, best_deals }', note:'best_deals uses subquery pattern to avoid PostgreSQL HAVING alias issue.' },
  ]},
  { section:'🤖 Automation', items:[
    { method:'GET',  path:'/api/health',              auth:false, desc:'Server health check', body:'none', response:'{ status, time, env }', note:'Called by cron-job.org every 5 minutes to keep Render awake.' },
    { method:'GET',  path:'/api/cron/check-prices',   auth:false, desc:'Trigger auto price scraping', body:'Query: ?key=CRON_SECRET', response:'{ message, time }', note:'Called by cron-job.org every 6 hours. Runs scraper on all watched products in background.' },
    { method:'POST', path:'/scrape',                  auth:true,  desc:'Auto-fetch price from URL', body:'{ url: string }', response:'{ success, price, name, image, method }', note:'3-tier: (1) HTTP fetch + cheerio meta tags → (2) Puppeteer headless Chrome → (3) return null.' },
  ]},
];

function renderEndpoints() {
  const grid = document.getElementById('endpoints-grid');
  if (!grid) return;
  grid.innerHTML = ENDPOINTS.map(sec => `
    <div class="ep-section-title">${sec.section}</div>
    ${sec.items.map((ep,i) => {
      const id = `ep-${sec.section.replace(/[^a-z0-9]/gi,'')}-${i}`;
      return `<div class="endpoint-card">
        <div class="endpoint-header" onclick="toggleEP('${id}')">
          <span class="method-badge method-${ep.method.toLowerCase()}">${ep.method}</span>
          <span class="endpoint-path">${ep.path}</span>
          <span class="endpoint-desc">${ep.desc}</span>
          <span class="endpoint-auth ${ep.auth?'':'public'}">${ep.auth?'🔒 Auth':'🌐 Public'}</span>
        </div>
        <div class="endpoint-body" id="${id}">
          <div class="ep-meta-label">Request body</div>
          <div class="ep-code">${ep.body}</div>
          <div class="ep-meta-label">Response</div>
          <div class="ep-code">${ep.response}</div>
          ${ep.note ? `<div class="endpoint-note"><strong>Note:</strong> ${ep.note}</div>` : ''}
        </div>
      </div>`;
    }).join('')}
  `).join('');
}

function toggleEP(id) {
  document.getElementById(id)?.classList.toggle('open');
}