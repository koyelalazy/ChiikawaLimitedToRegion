import os
import json
import time
import random
import sys
import requests
from bs4 import BeautifulSoup
from flask import Flask, render_template, jsonify, request
import firebase_admin
from firebase_admin import credentials
from firebase_admin import db
from geopy.geocoders import Nominatim

# 防止 Windows 終端機亂碼
sys.stdout.reconfigure(encoding='utf-8')

app = Flask(__name__)

# --- Firebase 設定 ---
if os.path.exists('/etc/secrets/serviceAccountKey.json'):
    cred = credentials.Certificate('/etc/secrets/serviceAccountKey.json')
else:
    cred = credentials.Certificate("serviceAccountKey.json")

firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://chiikawalimitedtoregion-default-rtdb.asia-southeast1.firebasedatabase.app/' 
})

DB_FILE = 'chiikawa_db.json'
BASE_URL = "https://www.jp-api.com/contents/NOD62/PGE{}/"
DOMAIN = "https://www.jp-api.com"

# --- 地點 -> 分區 對照表 (更新版) ---
LOCATION_TO_REGION = {
    # 北海道
    "北海道": "北海道", "札幌": "北海道", "函館": "北海道", "小樽": "北海道",
    # 東北
    "青森": "東北", "岩手": "東北", "宮城": "東北", "秋田": "東北", "山形": "東北", "福島": "東北", "仙台": "東北",
    # 關東 (含東日本)
    "茨城": "關東", "栃木": "關東", "群馬": "關東", "埼玉": "關東", "千葉": "關東", "東京": "關東", "神奈川": "關東",
    "市川": "關東", "足利": "關東", "橫濱": "關東", "横浜": "關東", "箱根": "關東", "鎌倉": "關東", "日光": "關東", "草津": "關東",
    "東日本": "關東", # 新增
    # 中部 (含東海、信州)
    "新潟": "中部", "富山": "中部", "石川": "中部", "福井": "中部", "山梨": "中部", "長野": "中部", "岐阜": "中部", "靜岡": "中部", "静岡": "中部", "愛知": "中部",
    "信州": "中部", "清水": "中部", "次郎長": "中部", "飛驒": "中部", "飛騨": "中部", "名古屋": "中部", "富士山": "中部", "合掌村": "中部",
    "東海": "中部", # 新增
    # 近畿 (含西日本、金閣寺)
    "三重": "近畿", "滋賀": "近畿", "京都": "近畿", "大阪": "近畿", "兵庫": "近畿", "奈良": "近畿", "和歌山": "近畿",
    "淡路": "近畿", "神戶": "近畿", "伏見": "近畿", "伊勢": "近畿", "姬路": "近畿",
    "金閣寺": "近畿", "西日本": "近畿", # 新增
    # 中國
    "鳥取": "中國", "島根": "中國", "岡山": "中國", "廣島": "中國", "広島": "中國", "山口": "中國",
    "宮島": "中國", "出雲": "中國",
    # 四國
    "德島": "四國", "徳島": "四國", "香川": "四國", "愛媛": "四國", "高知": "四國",
    "鳴門": "四國",
    # 九州
    "福岡": "九州", "佐賀": "九州", "長崎": "九州", "熊本": "九州", "大分": "九州", "宮崎": "九州", "鹿兒島": "九州", "鹿児島": "九州",
    "奄美": "九州", "博多": "九州", "別府": "九州",
    # 沖繩
    "沖繩": "沖繩", "沖縄": "沖繩", "石垣": "沖繩", "宮古": "沖繩",
    # 海外
    "香港": "海外", "澳門": "海外", "澳洲": "海外", "台灣": "海外", "韓國": "海外", "ハワイ": "海外"
}

def get_region_from_address(address):
    # address 可以是 Geopy 回傳的長地址，也可以是使用者的 search_location
    for place, region in LOCATION_TO_REGION.items():
        if place in address:
            return region
    return None

REGION_COORDS = {
    "北海道": {"lat": 43.0618, "lng": 141.3545},
    "東北":   {"lat": 38.2682, "lng": 140.8694},
    "關東":   {"lat": 35.6895, "lng": 139.6917},
    "中部":   {"lat": 35.1815, "lng": 136.9066},
    "近畿":   {"lat": 34.6937, "lng": 135.5023},
    "中國":   {"lat": 34.3853, "lng": 132.4553},
    "四國":   {"lat": 34.3428, "lng": 134.0466},
    "九州":   {"lat": 33.5904, "lng": 130.4017},
    "沖繩":   {"lat": 26.2124, "lng": 127.6809},
    "海外":   {"lat": 22.3193, "lng": 114.1694},
    "其他":   {"lat": 35.0, "lng": 139.0},
    "空港":   {"lat": 35.5494, "lng": 139.7798}
}

SPOT_COORDS = {
    "伏見": {"lat": 34.9671, "lng": 135.7727},
    "稲荷": {"lat": 34.9671, "lng": 135.7727},
    "京都": {"lat": 35.0116, "lng": 135.7681},
    "清水寺": {"lat": 34.9949, "lng": 135.7850},
    "八橋": {"lat": 35.0035, "lng": 135.7727},
    "奈良": {"lat": 34.6851, "lng": 135.8048},
    "鹿":   {"lat": 34.6851, "lng": 135.8048},
    "大佛": {"lat": 34.6851, "lng": 135.8048},
    "神戶": {"lat": 34.6901, "lng": 135.1955},
    "通天閣": {"lat": 34.6525, "lng": 135.5063},
    "大阪城": {"lat": 34.6873, "lng": 135.5262},
    "伊勢": {"lat": 34.4550, "lng": 136.7258},
    "雷門": {"lat": 35.7111, "lng": 139.7964},
    "淺草": {"lat": 35.7111, "lng": 139.7964},
    "晴空塔": {"lat": 35.7100, "lng": 139.8107},
    "東京鐵塔": {"lat": 35.6586, "lng": 139.7454},
    "熊貓": {"lat": 35.7141, "lng": 139.7741},
    "箱根": {"lat": 35.2324, "lng": 139.1069},
    "鎌倉": {"lat": 35.3191, "lng": 139.5505},
    "大仏": {"lat": 35.3167, "lng": 139.5361},
    "日光": {"lat": 36.7199, "lng": 139.6982},
    "草津": {"lat": 36.6228, "lng": 138.5961},
    "富士山": {"lat": 35.3606, "lng": 138.7274},
    "合掌村": {"lat": 36.2561, "lng": 136.9044},
    "白川鄉": {"lat": 36.2561, "lng": 136.9044},
    "名古屋": {"lat": 35.1815, "lng": 136.9066},
    "太宰府": {"lat": 33.5215, "lng": 130.5349},
    "熊本城": {"lat": 32.8062, "lng": 130.7058},
    "櫻島":   {"lat": 31.5932, "lng": 130.6574},
    "石垣":   {"lat": 24.3448, "lng": 124.1572},
    "水族館": {"lat": 26.6943, "lng": 127.8779},
    "函館": {"lat": 41.7687, "lng": 140.7288},
    "仙台": {"lat": 38.2682, "lng": 140.8694},
    "廣島": {"lat": 34.3853, "lng": 132.4553},
    "宮島": {"lat": 34.2960, "lng": 132.3199},
    "沙丘": {"lat": 35.5413, "lng": 134.2294},
    "出雲": {"lat": 35.4020, "lng": 132.6855},
    "群馬": {"lat": 36.3895, "lng": 139.0634},
    "清水": {"lat": 35.0160, "lng": 138.4863},
    "次郎長": {"lat": 35.0160, "lng": 138.4863},
    "空港": {"lat": 35.5494, "lng": 139.7798},
    "パイロット": {"lat": 35.5494, "lng": 139.7798},
    "飛行機": {"lat": 35.7720, "lng": 140.3929},
}

REGION_KEYWORDS = {
    "北海道": ["北海道", "札幌", "富良野", "函館", "小樽", "旭山", "薰衣草", "ラベンダー", "哈密瓜", "メロン", "玉米", "とうもろこし", "熊", "クマ", "鮭魚", "鮭", "狐狸", "キツネ", "丹頂鶴", "流冰", "クリオネ", "成吉思汗", "ジンギスカン", "拉麵", "ラーメン", "雪", "長尾山雀", "銀喉長尾山雀", "シマエナガ"],
    "東北": ["東北", "青森", "岩手", "宮城", "秋田", "山形", "福島", "仙台", "蘋果", "りんご", "睡魔", "ねぶた", "赤貝", "赤べこ", "伊達", "政宗", "毛豆", "ずんだ", "牛舌", "牛タン", "生剝鬼", "なまはげ", "小芥子", "こけし", "白虎隊", "米沢牛", "三陸", "碗子蕎麥", "わんこそば", "櫻桃", "さくらんぼ"],
    "關東": ["關東", "関東", "東京", "神奈川", "千葉", "埼玉", "茨城", "栃木", "群馬", "雷門", "浅草", "淺草", "晴空塔", "スカイツリー", "東京鐵塔", "東京タワー", "熊貓", "パンダ", "上野", "澀谷", "渋谷", "八公", "ハチ公", "箱根", "大涌谷", "黑蛋", "黒たまご", "寄木細工", "橫濱", "横浜", "中華街", "燒賣", "シューマイ", "鎌倉", "大佛", "大仏", "江之島", "草津", "日光", "猴子", "猿", "餃子", "納豆", "花生", "落花生"],
    "中部": ["中部", "愛知", "名古屋", "靜岡", "静岡", "岐阜", "長野", "山梨", "新潟", "富山", "石川", "福井", "北陸", "信州", "飛驒", "飛騨", "富士山", "ふじさん", "茶", "お茶", "わさび", "山葵", "鰻魚", "うなぎ", "金鯱", "しゃちほこ", "炸蝦", "エビフライ", "紅豆吐司", "小倉トースト", "合掌村", "白川鄉", "猴子泡湯", "蘋果", "蕎麥", "そば", "越光米", "米", "螃蟹", "カニ", "鬱金香", "チューリップ", "雷鳥", "清水", "次郎長"],
    "近畿": ["近畿", "關西", "関西", "大阪", "京都", "兵庫", "神戶", "神戸", "奈良", "滋賀", "和歌山", "三重", "伊勢", "章魚燒", "たこ焼", "通天閣", "大阪城", "好燒", "お好み焼き", "虎", "タイガース", "豹紋", "八橋", "八ッ橋", "抹茶", "新選組", "舞妓", "伏見稻荷", "伏見稲荷", "狐", "清水寺", "鹿", "大佛", "信樂燒", "狸貓", "琵琶湖", "彥根貓", "熊貓", "パンダ", "梅", "橘子", "みかん", "珍珠", "真珠"],
    "中國": ["中國", "中国", "廣島", "広島", "岡山", "鳥取", "島根", "山口", "瀨戶內", "瀬戸内", "檸檬", "レモン", "楓葉", "もみじ", "紅葉饅頭", "廣島燒", "牡蠣", "桃太郎", "牛仔褲", "麝香葡萄", "沙丘", "梨", "二十世紀梨", "白兔", "因幡", "いなばの白うさぎ", "河豚", "ふく", "ふぐ"],
    "四國": ["四國", "四国", "香川", "德島", "徳島", "愛媛", "高知", "烏龍麵", "うどん", "橄欖", "オリーブ", "橘子", "みかん", "伊予", "道後", "少爺", "坊っちゃん", "阿波", "阿波舞", "鳴門", "漩渦", "鰹魚", "カツオ", "柚子"],
    "九州": ["九州", "福岡", "博多", "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿兒島", "鹿児島", "明太子", "拉麵", "ラーメン", "草莓", "あまおう", "太宰府", "長崎蛋糕", "カステラ", "眼鏡橋", "熊", "くまモン", "熊本城", "別府", "由布院", "芒果", "日南", "摩艾", "黑豬", "黒豚", "白熊", "冰", "しろくま", "櫻島", "蘿蔔"],
    "沖繩": ["沖繩", "沖縄", "那霸", "石垣", "宮古", "風獅爺", "シーサー", "扶桑花", "ハイビスカス", "鳳梨", "パイン", "紅芋", "苦瓜", "ゴーヤ", "水族館", "鯨鯊", "ジンベエザメ", "三線", "水牛", "星砂"],
    "海外": ["香港", "澳門", "台灣", "澳洲", "ハワイ"]
}

def load_db():
    ref = db.reference('items')
    data = ref.get()
    return data if data else []

def save_db(data):
    ref = db.reference('items')
    ref.set(data)

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
        try:
            resp = requests.get(url, headers=HEADERS, timeout=10)
            resp.encoding = resp.apparent_encoding 
            if resp.status_code != 200: break
            soup = BeautifulSoup(resp.content, "html.parser")
            links = soup.find_all("a", class_="lightbox")
            if not links: break

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
            break
    return all_items

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
    for item in current_data:
        if item['id'] == target_id:
            item['owned'] = not item.get('owned', False)
            break
    save_db(current_data)
    return jsonify({"status": "success"})

# --- 共用判斷邏輯 ---
def apply_region_logic(item):
    loc_str = item.get('search_location', '')
    name = item.get('name', '')
    
    new_region = None
    
    # 1. 優先使用 search_location 判斷 (直接查表)
    if loc_str:
        new_region = get_region_from_address(loc_str)
        
        # 補強：如果對照表沒抓到，檢查關鍵字
        if not new_region:
            if "空港" in loc_str or "機場" in loc_str:
                new_region = "其他" 
    
    # 2. 如果 search_location 沒結果，使用原本的名產關鍵字規則
    if not new_region:
        if "パイロット" in name or "飛行機" in name or "CA" in name:
            new_region = "其他" 
        else:
            for r_key, keywords in REGION_KEYWORDS.items():
                if any(k in name for k in keywords):
                    new_region = r_key
                    break
    
    # 3. 預設其他
    if not new_region:
        new_region = "其他"
        
    return new_region

# --- API: 強制修正地區 ---
@app.route('/api/fix_regions', methods=['POST'])
def fix_regions():
    current_data = load_db()
    updated_count = 0
    
    for item in current_data:
        old_region = item.get('region')
        new_region = apply_region_logic(item)
        
        if new_region and new_region != old_region:
            item['region'] = new_region
            updated_count += 1
            
    save_db(current_data)
    return jsonify({"status": "success", "updated": updated_count})

@app.route('/api/import_data', methods=['POST'])
def import_data():
    try:
        new_items = request.json
        if not isinstance(new_items, list):
            return jsonify({"status": "error", "message": "格式錯誤"}), 400

        current_data = load_db()
        current_map = {item['name']: item for item in current_data}

        geolocator = Nominatim(user_agent="chiikawa_map_app_v1")
        
        updated_items = []
        geocoded_count = 0

        for item in new_items:
            should_geocode = False
            search_query = item.get('search_location', '').strip()
            item_name = item['name']

            if search_query:
                if item_name in current_map:
                    old_item = current_map[item_name]
                    old_query = old_item.get('search_location', '').strip()
                    
                    if old_query == search_query and 'lat' in old_item and 'lng' in old_item:
                        item['lat'] = old_item['lat']
                        item['lng'] = old_item['lng']
                        if item['region'] == '其他' and old_item.get('region') != '其他':
                            item['region'] = old_item['region']
                        print(f"[{item_name}] 地點未變動，沿用資料")
                    else:
                        should_geocode = True
                else:
                    should_geocode = True

            if should_geocode:
                print(f"[{item_name}] 正在查詢新地點: {search_query}")
                try:
                    location = geolocator.geocode(search_query, language='ja')
                    if location:
                        item['lat'] = location.latitude
                        item['lng'] = location.longitude
                        geocoded_count += 1
                    time.sleep(1.1) 
                except Exception as e:
                    print(f"查詢失敗: {e}")
            
            # 🔥 每次匯入都重新計算一次正確的 Region
            item['region'] = apply_region_logic(item)

            updated_items.append(item)

        save_db(updated_items)
        return jsonify({"status": "success", "geocoded": geocoded_count})
        
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

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
        
        target_lat = None
        target_lng = None
        spread = 0.15 
        
        has_manual_location = False
        
        if name in existing_map:
            old_item = existing_map[name]
            
            if 'search_location' in old_item and old_item['search_location']:
                final_item['lat'] = old_item['lat']
                final_item['lng'] = old_item['lng']
                final_item['search_location'] = old_item['search_location']
                has_manual_location = True
                
                # 🔥 確保爬蟲更新時，手動地點的分類也是正確的
                final_item['region'] = apply_region_logic(final_item)

        if not has_manual_location:
            for spot_key, coords in SPOT_COORDS.items():
                if spot_key in name:
                    target_lat = coords['lat']
                    target_lng = coords['lng']
                    spread = 0.005
                    break 
            
            if target_lat is None:
                base_coord = REGION_COORDS.get(final_item['region'], REGION_COORDS["其他"])
                target_lat = base_coord['lat']
                target_lng = base_coord['lng']
            
            final_item['lat'] = target_lat + (random.random() - 0.5) * spread
            final_item['lng'] = target_lng + (random.random() - 0.5) * spread
        
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
    app.run(debug=True, port=5000)