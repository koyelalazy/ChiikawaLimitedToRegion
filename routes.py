from flask import Blueprint, jsonify, request
from services.database import load_public_db, save_public_db
from services.crawler import run_crawler
from services.location import apply_region_logic, SPOT_COORDS, REGION_COORDS
import random

api_bp = Blueprint('api', __name__)

# --- 1. 讀取公有商品資料 (給前端顯示用) ---
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
        
        if key in existing_map:
            old_item = existing_map[key]
            # 繼承手動地點
            if 'search_location' in old_item and old_item['search_location']:
                final_item['lat'] = old_item['lat']
                final_item['lng'] = old_item['lng']
                final_item['search_location'] = old_item['search_location']
                final_item['region'] = old_item.get('region', final_item['region'])
                has_manual_location = True

        # 自動定位
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

# --- 3. 修正地區 ---
@api_bp.route('/api/fix_regions', methods=['POST'])
def fix_regions():
    items = load_public_db()
    updated_count = 0
    for item in items:
        old_region = item.get('region')
        new_region = apply_region_logic(item)
        if new_region and new_region != old_region:
            item['region'] = new_region
            updated_count += 1
    save_public_db(items)
    return jsonify({"status": "success", "updated": updated_count})

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