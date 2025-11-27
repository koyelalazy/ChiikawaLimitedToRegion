import os
import time
import random
import sys
import requests
from bs4 import BeautifulSoup
from flask import Flask, render_template, jsonify, request

# --- Firebase 相關 ---
import firebase_admin
from firebase_admin import credentials
from firebase_admin import db

# 防止 Windows 終端機亂碼
sys.stdout.reconfigure(encoding='utf-8')

app = Flask(__name__)

# --- Firebase 設定 (請修改這裡!) ---
if os.path.exists('/etc/secrets/serviceAccountKey.json'):
    cred = credentials.Certificate('/etc/secrets/serviceAccountKey.json')
else:
    # 在自己電腦上
    cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://chiikawalimitedtoregion-default-rtdb.asia-southeast1.firebasedatabase.app/' 
})

BASE_URL = "https://www.jp-api.com/contents/NOD62/PGE{}/"
DOMAIN = "https://www.jp-api.com"

# 地區中心座標
REGION_COORDS = {
    "北海道": {"lat": 43.0618, "lng": 141.3545},
    "東北":   {"lat": 38.2682, "lng": 140.8694},
    "關東":   {"lat": 35.6895, "lng": 139.6917},
    "中部":   {"lat": 35.1815, "lng": 136.9066},
    "關西":   {"lat": 34.6937, "lng": 135.5023},
    "中國":   {"lat": 34.3853, "lng": 132.4553},
    "四國":   {"lat": 34.3428, "lng": 134.0466},
    "九州":   {"lat": 33.5904, "lng": 130.4017},
    "沖繩":   {"lat": 26.2124, "lng": 127.6809},
    "溫泉":   {"lat": 35.2304, "lng": 139.1069},
    "機場":   {"lat": 35.5494, "lng": 139.7798},
    "其他":   {"lat": 35.0, "lng": 139.0}
}

REGION_KEYWORDS = {
    "北海道": ["北海道", "札幌", "富良野", "薰衣草", "哈密瓜", "熊", "雪", "狐狸"],
    "東北": ["青森", "岩手", "宮城", "秋田", "山形", "福島", "仙台", "赤貝", "蘋果", "伊達", "白虎隊", "米沢牛"],
    "關東": ["東京", "神奈川", "千葉", "埼玉", "茨城", "栃木", "群馬", "雷門", "晴空塔", "熊貓", "箱根", "橫濱", "鎌倉", "寄木細工"],
    "中部": ["新潟", "富山", "石川", "福井", "山梨", "長野", "岐阜", "靜岡", "愛知", "名古屋", "富士山", "信州", "飛驒", "合掌村"],
    "關西": ["大阪", "京都", "兵庫", "奈良", "滋賀", "和歌山", "神戶", "章魚燒", "八橋", "鹿", "新選組", "舞妓", "通天閣", "大仏"],
    "中國": ["鳥取", "島根", "岡山", "廣島", "山口", "瀨戶內", "檸檬", "桃太郎", "いなばの白うさぎ", "ふく"],
    "四國": ["德島", "香川", "愛媛", "高知", "烏龍麵", "橘子", "阿波", "さぬきうどん"],
    "九州": ["福岡", "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿兒島", "明太子", "拉麵", "草莓", "長崎蛋糕", "氷しろくま"],
    "沖繩": ["沖繩", "石垣", "風獅爺", "鳳梨", "紅芋", "苦瓜", "水族館", "鯨鯊", "シーサー", "ジンベエザメ"],
    "溫泉": ["溫泉", "温泉"],
    "機場": ["機場", "空港", "パイロット"],
}

# --- 資料庫操作 (改為 Firebase) ---
def load_db():
    # 從 Firebase 的 'items' 節點讀取資料
    ref = db.reference('items')
    data = ref.get()
    if data is None:
        return []
    return data

def save_db(data):
    # 將資料寫入 Firebase 的 'items' 節點
    ref = db.reference('items')
    ref.set(data)

# --- 爬蟲邏輯 (維持不變) ---
def run_crawler():
    print("Crawler started...")
    all_items = []
    page = 1
    MAX_PAGES = 10 
    
    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    while page <= MAX_PAGES:
        url = BASE_URL.format(page)
        print(f"Reading page: {url}")
        
        try:
            resp = requests.get(url, headers=HEADERS, timeout=10)
            resp.encoding = resp.apparent_encoding 
            
            if resp.status_code != 200:
                break
            
            soup = BeautifulSoup(resp.content, "html.parser")
            links = soup.find_all("a", class_="lightbox")
            
            if not links:
                break

            for link in links:
                name = link.get("title", "").strip()
                if not name: 
                    img = link.find("img")
                    if img: name = img.get("alt", "").strip()
                
                if not name: continue

                src = link.get("href", "")
                img_url = DOMAIN + src if src.startswith("/") else src

                region = "其他"
                for r_key, keywords in REGION_KEYWORDS.items():
                    if any(k in name for k in keywords):
                        region = r_key
                        break
                
                category = "other"
                if "ダイカットキーホルダー" in name:
                    category = "tag"
                elif "ぬいぐるみキーチェーン" in name:
                    category = "plush"

                all_items.append({
                    "name": name,
                    "image": img_url,
                    "region": region,
                    "category": category
                })
            
            page += 1
            time.sleep(1)

        except Exception as e:
            print(f"Error: {e}")
            break
    
    return all_items

# --- 路由 ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/items', methods=['GET'])
def get_items():
    return jsonify(load_db())

@app.route('/api/toggle_item', methods=['POST'])
def toggle_item():
    target_id = request.json.get('id')
    current_data = load_db()
    
    # 在 Python 處理更新，然後整包推回 Firebase
    # (進階做法是只更新該節點，但為了簡單起見，我們先整包更新)
    for item in current_data:
        if item['id'] == target_id:
            item['owned'] = not item.get('owned', False)
            break
            
    save_db(current_data)
    return jsonify({"status": "success"})

@app.route('/api/refresh', methods=['POST'])
def refresh_data():
    crawled_items = run_crawler()
    current_db = load_db()
    
    existing_map = {item['name']: item for item in current_db}
    updated_list = []
    new_id = 1
    
    for c_item in crawled_items:
        name = c_item['name']
        final_item = c_item.copy()
        final_item['id'] = new_id
        
        base_coord = REGION_COORDS.get(final_item['region'], REGION_COORDS["其他"])
        final_item['lat'] = base_coord['lat'] + (random.random() - 0.5) * 0.15
        final_item['lng'] = base_coord['lng'] + (random.random() - 0.5) * 0.15
        
        if final_item['category'] == 'plush':
            final_item['emoji'] = "🧸"
        elif final_item['category'] == 'tag':
            final_item['emoji'] = "🏷️"
        else:
            final_item['emoji'] = "✨"

        if name in existing_map:
            final_item['owned'] = existing_map[name].get('owned', False)
        else:
            final_item['owned'] = False
            
        updated_list.append(final_item)
        new_id += 1
    
    save_db(updated_list)
    return jsonify({"status": "success", "total": len(updated_list)})

if __name__ == '__main__':
    print("App is starting with Firebase...")
    app.run(debug=True, port=5000)