"""
PriceWatch AI — Price Prediction Service
==========================================
Simple but accurate ML predictor using Linear + Polynomial Regression.
No complex setup needed — pure Python, runs on Render for free.

How it works (for your viva):
  1. Fetch price history from Supabase PostgreSQL
  2. Convert dates → day numbers (day 0, 1, 2 ...)
  3. Fit a polynomial regression curve through the price points
  4. Extend the curve 7 days into the future
  5. Analyze the slope to generate buying insights
  6. Return JSON with predictions + insight + confidence score

Start as HTTP server:  python predict.py --serve
Test one product:      python predict.py --product_id 1
"""

import os, sys, json, argparse
from datetime import datetime, timedelta, timezone

# ── Check required libraries ──────────────────────────────────
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print(json.dumps({"error": "Run: pip install psycopg2-binary"}))
    sys.exit(1)

try:
    import numpy as np
    from sklearn.linear_model import LinearRegression
    from sklearn.preprocessing import PolynomialFeatures
    from sklearn.metrics import r2_score
except ImportError:
    print(json.dumps({"error": "Run: pip install numpy scikit-learn"}))
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ─────────────────────────────────────────────────────────────
# DATABASE
# ─────────────────────────────────────────────────────────────
def get_conn():
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise Exception("DATABASE_URL not set in environment.")
    return psycopg2.connect(url, sslmode='require')

def fetch_history(product_id):
    sql = """
        SELECT price::float AS price, recorded_at
        FROM   price_history
        WHERE  product_id = %s
        ORDER  BY recorded_at ASC
    """
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (product_id,))
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

def fetch_product(product_id):
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT name, category, url FROM products WHERE product_id = %s", (product_id,))
            row = cur.fetchone()
            return dict(row) if row else {}
    finally:
        conn.close()

# ─────────────────────────────────────────────────────────────
# ML PIPELINE
# ─────────────────────────────────────────────────────────────
def to_day_numbers(history):
    """Convert timestamps to numeric day offsets from first entry."""
    dates, prices = [], []
    for row in history:
        dt = row['recorded_at']
        if isinstance(dt, str):
            dt = datetime.fromisoformat(dt.replace('Z','+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dates.append(dt)
        prices.append(float(row['price']))
    base = dates[0]
    days = [(d - base).total_seconds() / 86400 for d in dates]
    return np.array(days).reshape(-1,1), np.array(prices), base, dates

def train(X, y):
    """
    Polynomial Regression (degree 2).
    degree=1 for <5 points (linear), degree=2 otherwise (curve).
    R² score tells us how well the model fits (0=bad, 1=perfect).
    """
    degree = 1 if len(X) < 5 else 2
    poly   = PolynomialFeatures(degree=degree, include_bias=False)
    Xp     = poly.fit_transform(X)
    model  = LinearRegression().fit(Xp, y)
    r2     = max(0.0, r2_score(y, model.predict(Xp)))
    return model, poly, r2

def predict_next_7(model, poly, X, base_date):
    """Extend the regression curve 7 days beyond the last data point."""
    last_day = float(X[-1][0])
    results  = []
    for i in range(1, 8):
        day        = last_day + i
        pred_price = max(1.0, model.predict(poly.transform([[day]]))[0])
        future_dt  = base_date + timedelta(days=day)
        results.append({
            "date":  future_dt.strftime("%Y-%m-%d"),
            "price": round(float(pred_price), 2),
        })
    return results

def make_insight(current_price, preds, y, r2):
    """Generate human-readable insight from predictions."""
    prices      = [p['price'] for p in preds]
    min_price   = min(prices)
    max_price   = max(prices)
    min_idx     = prices.index(min_price)
    best_day    = preds[min_idx]['date']
    last_pred   = prices[-1]
    pct_change  = (last_pred - current_price) / current_price * 100

    # Detect sudden single-day drops > 5%
    drop_detected = any(
        (prices[i] - prices[i-1]) / prices[i-1] * 100 < -5
        for i in range(1, len(prices))
    )

    # Trend classification
    if pct_change < -3:
        trend = 'falling'
    elif pct_change > 3:
        trend = 'rising'
    else:
        trend = 'stable'

    # Confidence score: R² × data-quantity factor (needs 10+ points for 100%)
    data_factor = min(1.0, len(y) / 10)
    confidence  = round(max(0, min(100, r2 * data_factor * 100)), 1)

    savings = round(current_price - min_price, 2)

    if trend == 'falling':
        if drop_detected:
            insight = (f"🚨 Sharp drop detected! Price expected to fall by ₹{abs(savings):,.0f} "
                       f"in the next {min_idx+1} day(s). Best time to buy: {best_day}.")
        else:
            insight = (f"📉 Price trending down by {abs(pct_change):.1f}% over 7 days. "
                       f"Consider waiting — best price expected on {best_day} (₹{min_price:,.0f}).")
    elif trend == 'rising':
        insight = (f"📈 Price likely to rise by {abs(pct_change):.1f}% over 7 days. "
                   f"Buy now before it increases. Current price is the best available.")
    else:
        insight = (f"➡️ Price is stable (±{abs(pct_change):.1f}%). "
                   f"No rush — lowest predicted price: ₹{min_price:,.0f} on {best_day}.")

    if confidence < 40:
        insight += f" ⚠️ Low confidence ({len(y)} data points — more price updates improve accuracy)."

    return {
        "insight":         insight,
        "trend":           trend,
        "confidence":      confidence,
        "drop_detected":   drop_detected,
        "best_buy_day":    best_day,
        "min_predicted":   round(min_price, 2),
        "max_predicted":   round(max_price, 2),
        "expected_change_pct": round(pct_change, 2),
    }

# ─────────────────────────────────────────────────────────────
# MAIN PREDICT FUNCTION
# ─────────────────────────────────────────────────────────────
def predict(product_id):
    """Full pipeline: fetch → train → predict → insight → return JSON."""
    try:
        history = fetch_history(product_id)
        product = fetch_product(product_id)

        if len(history) < 3:
            return {
                "product_id": product_id,
                "product_name": product.get('name',''),
                "error": f"Need at least 3 price records. Currently have {len(history)}.",
                "prediction": [],
                "insight": "Add more price data to enable AI predictions.",
                "confidence": 0,
                "trend": "unknown",
            }

        X, y, base_date, dates = to_day_numbers(history)
        model, poly, r2        = train(X, y)
        predictions            = predict_next_7(model, poly, X, base_date)

        current_price = float(y[-1])
        analysis      = make_insight(current_price, predictions, y, r2)

        # Last 14 points for history graph
        history_graph = []
        for row in history[-14:]:
            dt = row['recorded_at']
            history_graph.append({
                "date":  dt.strftime("%Y-%m-%d") if hasattr(dt,'strftime') else str(dt)[:10],
                "price": float(row['price']),
            })

        return {
            "product_id":      product_id,
            "product_name":    product.get('name',''),
            "current_price":   current_price,
            "data_points":     len(history),
            "r2_score":        round(r2, 4),
            "prediction":      predictions,
            "history":         history_graph,
            **analysis,
        }

    except Exception as e:
        return {
            "product_id": product_id,
            "error": str(e),
            "prediction": [],
            "insight": "Prediction failed.",
            "confidence": 0,
            "trend": "unknown",
        }

# ─────────────────────────────────────────────────────────────
# FLASK HTTP SERVER  (Node.js calls this)
# ─────────────────────────────────────────────────────────────
def run_server():
    try:
        from flask import Flask, jsonify
        from flask_cors import CORS
    except ImportError:
        print("Run: pip install flask flask-cors")
        sys.exit(1)

    app = Flask(__name__)
    CORS(app)

    @app.route('/predict/<int:product_id>')
    def predict_route(product_id):
        return jsonify(predict(product_id))

    @app.route('/health')
    def health():
        return jsonify({"status": "ok", "service": "PriceWatch AI"})

    port = int(os.environ.get("ML_PORT", 5001))
    print(f"\n🤖 PriceWatch AI running → http://localhost:{port}")
    app.run(host='0.0.0.0', port=port, debug=False)

# ─────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument('--product_id', type=int)
    ap.add_argument('--serve', action='store_true')
    args = ap.parse_args()

    if args.serve:
        run_server()
    elif args.product_id:
        print(json.dumps(predict(args.product_id), indent=2, default=str))
    else:
        ap.print_help()