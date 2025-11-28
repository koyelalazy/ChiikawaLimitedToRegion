import sys
import os
import mimetypes
from flask import Flask, render_template
from services.database import save_public_db # 確保 database 初始化邏輯被執行
from routes import api_bp 

# 強制告訴 Python .js 檔案就是 application/javascript
# 這行能解決 "MIME type of text/plain" 的錯誤
mimetypes.add_type('application/javascript', '.js')

# 防止 Windows 終端機亂碼
sys.stdout.reconfigure(encoding='utf-8')

app = Flask(__name__)

# 註冊 API 路由 (來自 routes.py)
app.register_blueprint(api_bp)

# 首頁路由
@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    print("🚀 System starting...")
    print("👉 Open: http://127.0.0.1:5000")
    app.run(debug=True, port=5000)