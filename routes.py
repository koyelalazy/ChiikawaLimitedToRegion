from flask import Blueprint, jsonify, request
from services.database import load_public_db, save_public_db
from services.crawler import run_crawler
# 引用新的 LOCATION_CORRECTIONS
from services.location import apply_region_logic, SPOT_COORDS, REGION_COORDS, LOCATION_CORRECTIONS 
import random

api_bp = Blueprint('api', __name__)

# --- 1. 讀取公有商品資料 ---
@api_bp.route('/api/public_items', methods=['GET'])
def get_public_items():
    items = load_public_db()
    return jsonify(items)

# --- 2. 管理員更新商品 (爬蟲 -> Firebase) ---
@api_bp.route('/api/refresh', methods=['POST'])
def refresh_data():
    old_items = load_public_db()
    existing_map = {}
    if old_items:
        for i in old_items:
            key = i.get('image', '').split('/')[-1] or i.get('name')
            existing_map[key] = i
    
    crawled_items = run_crawler()
    updated_list = []
    
    for idx, c_item in enumerate(crawled_items):
        final_item = c_item.copy()
        final_item['id'] = idx + 1
        
        key = final_item.get('image', '').split('/')[-1] or final_item['name']
        has_manual_location = False
        
        # 檢查是否有手動修正表對應
        loc = final_item.get('search_location', '')
        if not loc and key in existing_map:
             # 繼承舊資料的 search_location
             loc = existing_map[key].get('search_location', '')
             final_item['search_location'] = loc

        if loc and loc in LOCATION_CORRECTIONS:
            # 🔥 強制修正：使用對照表的座標和地區
            correct = LOCATION_CORRECTIONS[loc]
            final_item['lat'] = correct['lat']
            final_item['lng'] = correct['lng']
            final_item['region'] = correct['region']
            has_manual_location = True

        # 如果沒有強制修正，嘗試繼承舊資料
        if not has_manual_location and key in existing_map:
            old_item = existing_map[key]
            if 'search_location' in old_item and old_item['search_location']:
                final_item['lat'] = old_item['lat']
                final_item['lng'] = old_item['lng']
                final_item['search_location'] = old_item['search_location']
                final_item['region'] = old_item.get('region', final_item['region'])
                has_manual_location = True

        # 自動定位 (最後手段)
        if not has_manual_location:
            final_item['region'] = apply_region_logic(final_item)
            
            target_lat = None
            target_lng = None
            spread = 0.15 
            
            for spot_key, coords in SPOT_COORDS.items():
                if spot_key in final_item['name']:
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
        
        if final_item['category'] == 'plush': final_item['emoji'] = "🧸"
        elif final_item['category'] == 'tag': final_item['emoji'] = "🏷️"
        elif final_item['category'] == 'socks': final_item['emoji'] = "🧦"
        else: final_item['emoji'] = "✨"
        
        updated_list.append(final_item)
    
    save_public_db(updated_list)
    return jsonify({"status": "success", "total": len(updated_list)})

# --- 3. 修正地區 (大幅升級：連座標一起修) ---
@api_bp.route('/api/fix_regions', methods=['POST'])
def fix_regions():
    items = load_public_db()
    updated_count = 0
    
    for item in items:
        loc = item.get('search_location', '').strip()
        
        # 1. 強制修正 (查表)
        if loc and loc in LOCATION_CORRECTIONS:
            correct = LOCATION_CORRECTIONS[loc]
            # 檢查是否需要更新
            if (item.get('region') != correct['region'] or 
                abs(item.get('lat', 0) - correct['lat']) > 0.0001 or 
                abs(item.get('lng', 0) - correct['lng']) > 0.0001):
                
                item['lat'] = correct['lat']
                item['lng'] = correct['lng']
                item['region'] = correct['region']
                updated_count += 1
            continue 

        # 2. 自動判斷 (舊邏輯)
        old_region = item.get('region')
        
        # 優化：如果已經是有效地區，就跳過
        if old_region and old_region != "其他":
             continue

        new_region = apply_region_logic(item)
        if new_region and new_region != old_region:
            item['region'] = new_region
            updated_count += 1
            
    save_public_db(items)
    
    # 🔥 關鍵修正：直接回傳最新的 items 資料
    return jsonify({"status": "success", "data": items, "updated": updated_count})

# --- 4. 管理員匯入 ---
@api_bp.route('/api/import_public_data', methods=['POST'])
def import_public_data():
    try:
        new_items = request.json
        if not isinstance(new_items, list): return jsonify({"status": "error"}), 400
        save_public_db(new_items)
        return jsonify({"status": "success", "message": "Public DB updated"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500