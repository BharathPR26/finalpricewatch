-- ============================================================
-- PriceWatch v2 — PostgreSQL Schema
-- For Render.com hosting
-- ============================================================

-- ─── USERS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  user_id      SERIAL PRIMARY KEY,
  name         VARCHAR(100)  NOT NULL,
  email        VARCHAR(150)  NOT NULL UNIQUE,
  password     VARCHAR(255)  NOT NULL,
  notify_email BOOLEAN       DEFAULT TRUE,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

-- ─── PRODUCTS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  product_id  SERIAL PRIMARY KEY,
  name        VARCHAR(1000) NOT NULL,
  url         TEXT          NOT NULL,
  category    VARCHAR(50)   DEFAULT 'Other',
  image_url   TEXT,
  added_by    INT           NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

-- ─── PRICE HISTORY ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_history (
  ph_id       SERIAL PRIMARY KEY,
  product_id  INT           NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  price       DECIMAL(10,2) NOT NULL,
  recorded_at TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

-- ─── WATCHLIST ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlist (
  watch_id     SERIAL PRIMARY KEY,
  user_id      INT           NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  product_id   INT           NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  target_price DECIMAL(10,2) NOT NULL,
  is_active    BOOLEAN       DEFAULT TRUE,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, product_id)
);

-- ─── ALERTS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  alert_id        SERIAL PRIMARY KEY,
  watch_id        INT           NOT NULL REFERENCES watchlist(watch_id) ON DELETE CASCADE,
  triggered_price DECIMAL(10,2) NOT NULL,
  triggered_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  is_read         BOOLEAN       DEFAULT FALSE,
  email_sent      BOOLEAN       DEFAULT FALSE
);

-- ─── INDEXES ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ph_product  ON price_history(product_id);
CREATE INDEX IF NOT EXISTS idx_ph_time     ON price_history(recorded_at);
CREATE INDEX IF NOT EXISTS idx_wl_user     ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_alert_watch ON alerts(watch_id);
CREATE INDEX IF NOT EXISTS idx_alert_email ON alerts(email_sent);

-- ─── SEED DATA ───────────────────────────────────────────────
INSERT INTO users (name, email, password, notify_email) VALUES
  ('Demo User', 'demo@pricewatch.com',
   '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', TRUE)
ON CONFLICT (email) DO NOTHING;

INSERT INTO products (name, url, category, image_url, added_by) VALUES
  ('Sony WH-1000XM5 Headphones','https://amazon.in/sony-wh1000xm5','Electronics',
   'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400',1),
  ('Nike Air Max 270','https://flipkart.com/nike-airmax-270','Fashion',
   'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400',1),
  ('Atomic Habits','https://amazon.in/atomic-habits','Books',
   'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400',1)
ON CONFLICT DO NOTHING;

INSERT INTO price_history (product_id, price, recorded_at) VALUES
  (1,29990.00, NOW() - INTERVAL '30 days'),
  (1,28500.00, NOW() - INTERVAL '25 days'),
  (1,27999.00, NOW() - INTERVAL '20 days'),
  (1,26500.00, NOW() - INTERVAL '15 days'),
  (1,24990.00, NOW() - INTERVAL '10 days'),
  (1,23499.00, NOW() - INTERVAL '5 days'),
  (1,21999.00, NOW()),
  (2,8995.00,  NOW() - INTERVAL '20 days'),
  (2,8495.00,  NOW() - INTERVAL '14 days'),
  (2,7999.00,  NOW() - INTERVAL '7 days'),
  (2,7499.00,  NOW()),
  (3,499.00,   NOW() - INTERVAL '15 days'),
  (3,449.00,   NOW() - INTERVAL '8 days'),
  (3,399.00,   NOW())
ON CONFLICT DO NOTHING;

INSERT INTO watchlist (user_id, product_id, target_price) VALUES
  (1,1,22000.00),(1,2,7500.00),(1,3,400.00)
ON CONFLICT DO NOTHING;