import requests
import time
import concurrent.futures # 🔥 新增：多工處理模組
from bs4 import BeautifulSoup
from services.location import REGION_KEYWORDS

BASE_URL = "https://www.jp-api.com/contents/NOD62/PGE{}/"
DOMAIN = "https://www.jp-api.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

# 🔥 提取出單頁抓取的邏輯
def fetch_page(page):
    url = BASE_URL.format(page)
    items = []
    try:
        # print(f"正在抓取第 {page} 頁...") # 註解掉避免 log 太多
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.encoding = resp.apparent_encoding
        if resp.status_code != 200: return []
        
        soup = BeautifulSoup(resp.content, "html.parser")
        links = soup.find_all("a", class_="lightbox")
        
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
            elif "ソックス" in name or "靴下" in name:
                category = "socks"

            items.append({
                "name": name,
                "image": img_url,
                "region": region,
                "category": category
            })
    except Exception as e:
        print(f"Page {page} error: {e}")
    
    return items

# 🔥 主程式：改成並行處理
def run_crawler():
    print("🚀 啟動極速爬蟲 (多執行緒版)...")
    start_time = time.time()
    all_items = []
    
    # 設定要抓幾頁 (例如 1~10 頁)
    pages = range(1, 11) 
    
    # 同時開 5 個執行緒去抓
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        results = executor.map(fetch_page, pages)
        
    for res in results:
        all_items.extend(res)
        
    print(f"✅ 爬取完成！耗時: {time.time() - start_time:.2f} 秒，共 {len(all_items)} 筆")
    return all_items