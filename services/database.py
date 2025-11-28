import os
import json
import firebase_admin
from firebase_admin import credentials, db

# --- Firebase 初始化 (負責公有資料) ---
if not firebase_admin._apps:
    if os.path.exists('/etc/secrets/serviceAccountKey.json'):
        cred = credentials.Certificate('/etc/secrets/serviceAccountKey.json')
    else:
        cred = credentials.Certificate("serviceAccountKey.json")
    
    firebase_admin.initialize_app(cred, {
        # 請確認這是您的 Firebase 網址
        'databaseURL': 'https://chiikawalimitedtoregion-default-rtdb.asia-southeast1.firebasedatabase.app/' 
    })

# --- 公有資料庫操作 (Firebase) ---
def load_public_db():
    """從 Firebase 讀取所有商品"""
    ref = db.reference('public_items')
    data = ref.get()
    return data if data else []

def save_public_db(data):
    """將商品資料寫入 Firebase"""
    ref = db.reference('public_items')
    ref.set(data)