"""
WSGI entry point for Render deployment.
Run: gunicorn wsgi:app
"""
import os
from flask import Flask, jsonify
from flask_cors import CORS
from predict import predict

app = Flask(__name__)
CORS(app)

@app.route('/predict/<int:product_id>')
def predict_route(product_id):
    return jsonify(predict(product_id))

@app.route('/health')
def health():
    return jsonify({"status": "ok", "service": "PriceWatch AI"})

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5001))
    app.run(host='0.0.0.0', port=port)