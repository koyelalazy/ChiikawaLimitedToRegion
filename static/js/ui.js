export function setupUI(appState, AppConfig, storageFunctions, Vue) {
    const { ref, computed, watch, nextTick } = Vue;

    // --- 輔助：API 呼叫 ---
    const apiCall = async (url, method = 'GET', body = null) => {
        const headers = { 'Content-Type': 'application/json' };
        const config = { method, headers };
        if (body) config.body = JSON.stringify(body);

        try {
            const res = await fetch(url, config);
            const result = await res.json();
            if (result.status === 'error') {
                throw new Error(result.message || "API 請求錯誤");
            }
            return result;
        } catch (e) {
            console.error("API Error:", e);
            alert(`操作失敗: ${e.message}`);
            throw e;
        }
    };

    // --- 核心：資料合併 ---
    const mergeData = () => {
        if (!appState.publicItems.value || !Array.isArray(appState.publicItems.value)) {
            appState.items.value = [];
            return;
        }
        appState.items.value = appState.publicItems.value.map(pItem => {
            // Key 優先順序: 圖片檔名 > 名稱
            const key = pItem.image ? pItem.image.split('/').pop() : pItem.name;
            const uStat = appState.userStatus.value[key] || {};

            return {
                ...pItem,
                owned: uStat.owned || false,
                // search_location 由公有資料庫決定，若使用者有特殊覆蓋可在此邏輯擴充
            };
        });
        // 如果在地圖模式，更新標記
        if (appState.viewMode.value === 'map') {
            // 使用 nextTick 確保資料更新後才重繪
            nextTick(() => updateMapMarkers());
        }
    };

    // --- 讀取公有商品 ---
    const fetchPublicItems = async () => {
        try {
            const result = await apiCall('/api/public_items');
            appState.publicItems.value = Array.isArray(result) ? result : [];
            mergeData();
            if (appState.viewMode.value === 'map') initMap();
        } catch (e) { console.error(e); }
    };

    // --- Computed Properties ---
    const filteredItems = computed(() => {
        if (!appState.items.value || !Array.isArray(appState.items.value)) return [];
        return appState.items.value.filter(item => {
            const matchRegion = appState.selectedRegion.value === '全部' || item.region === appState.selectedRegion.value;
            const matchCategory = appState.selectedCategory.value === 'all' || item.category === appState.selectedCategory.value;
            const matchStatus = appState.statusFilter.value === 'all' ? true : appState.statusFilter.value === 'owned' ? item.owned : !item.owned;
            return matchRegion && matchCategory && matchStatus;
        });
    });

    const ownedCount = computed(() => appState.items.value ? appState.items.value.filter(i => i.owned).length : 0);
    const progressPercentage = computed(() => {
        if (!appState.items.value || appState.items.value.length === 0) return 0;
        return (ownedCount.value / appState.items.value.length) * 100;
    });

    // --- 事件處理 ---
    let saveTimeout = null;
    const toggleOwn = (item) => {
        item.owned = !item.owned;
        const key = item.image ? item.image.split('/').pop() : item.name;
        if (!appState.userStatus.value[key]) appState.userStatus.value[key] = {};
        appState.userStatus.value[key].owned = item.owned;

        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => { storageFunctions.saveUserData(); }, 1000);
    };

    const autoUpdate = async () => {
        appState.isUpdating.value = true;
        try {
            const res = await apiCall('/api/refresh', 'POST', appState.items.value);
            appState.publicItems.value = res.data; // 更新公有資料
            mergeData();
            alert(`更新完成！共 ${res.total} 筆商品。`);
        } catch (e) { /* apiCall 已處理 alert */ }
        finally { appState.isUpdating.value = false; }
    };

    const fixRegions = async () => {
        if (!confirm("確定要修正地區？")) return;
        appState.isUpdating.value = true;
        try {
            const res = await apiCall('/api/fix_regions', 'POST', appState.items.value);
            appState.publicItems.value = res.data;
            mergeData();
            alert(`修正完成！更新了 ${res.updated} 筆。`);
        } catch (e) { /*...*/ }
        finally { appState.isUpdating.value = false; }
    };

    const deletePublicData = async () => {
        const code = prompt("輸入 'DELETE' 確認刪除公有資料：");
        if (code !== 'DELETE') return;
        appState.isUpdating.value = true;
        try {
            await apiCall('/api/import_public_data', 'POST', []);
            appState.publicItems.value = [];
            mergeData();
            alert("公有資料庫已清空！");
        } catch (e) { /*...*/ }
        finally { appState.isUpdating.value = false; }
    };

    // --- 匯入匯出 ---
    const downloadJson = (contentStr, fileName) => {
        const blob = new Blob([contentStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
    };

    const exportUserData = () => {
        const dataStr = JSON.stringify(appState.userStatus.value, null, 2);
        downloadJson(dataStr, "my_collection_status.json");
    };

    const exportPublicData = () => {
        const dataStr = JSON.stringify(appState.publicItems.value, null, 2);
        downloadJson(dataStr, "chiikawa_public_db.json");
    };

    const triggerImportUser = () => document.getElementById('importUserFile').click();
    const importUserData = (event) => {
        const file = event.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const jsonContent = JSON.parse(e.target.result);
                if (!confirm("確定要還原收藏紀錄嗎？")) return;
                appState.userStatus.value = jsonContent;
                // mergeData 會由 main.js 的 watcher 觸發
                storageFunctions.saveUserData();
                alert("還原成功！");
            } catch (err) { alert("格式錯誤"); }
            finally { event.target.value = ''; }
        };
        reader.readAsText(file);
    };

    const triggerImportPublic = () => document.getElementById('importPublicFile').click();
    const importPublicData = (event) => {
        const file = event.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const jsonContent = JSON.parse(e.target.result);
                if (!confirm(`匯入 ${jsonContent.length} 筆資料？`)) return;
                appState.isUpdating.value = true;
                await apiCall('/api/import_public_data', 'POST', jsonContent);
                await fetchPublicItems();
                alert("匯入成功！");
            } catch (err) { /*...*/ }
            finally { appState.isUpdating.value = false; event.target.value = ''; }
        };
        reader.readAsText(file);
    };

    const resetSelections = () => {
        if (!confirm("確定要清除所有勾選？")) return;
        appState.userStatus.value = {};
        // mergeData 由 watcher 觸發
        storageFunctions.saveUserData();
    };

    // --- Map & Modal ---
    const toggleModalItem = () => { if (appState.modalItem.value) toggleOwn(appState.modalItem.value); };
    const updateModalContent = () => {
        if (!filteredItems.value.length) return;
        const item = filteredItems.value[appState.currentModalIndex.value];
        if (item) {
            appState.modalImage.value = item.image;
            appState.modalTitle.value = item.name;
            appState.modalSubtitle.value = `${item.region} | ${item.category === 'tag' ? '鐵牌' : item.category === 'plush' ? '娃娃' : item.category === 'socks' ? '襪子' : '其他'}`;
            appState.modalItem.value = item;
        }
    };
    const openImage = (item, index) => { appState.currentModalIndex.value = index; updateModalContent(); appState.showModal.value = true; };
    const closeModal = () => appState.showModal.value = false;
    const nextImage = () => { if (appState.currentModalIndex.value < filteredItems.value.length - 1) { appState.currentModalIndex.value++; updateModalContent(); } };
    const prevImage = () => { if (appState.currentModalIndex.value > 0) { appState.currentModalIndex.value--; updateModalContent(); } };

    // Map Data
    const MAJOR_AIRPORTS = [
        { name: "新千歲空港", lat: 42.7934, lng: 141.6923 }, { name: "函館空港", lat: 41.7704, lng: 140.8222 },
        { name: "仙台空港", lat: 38.1398, lng: 140.9169 }, { name: "羽田空港", lat: 35.5494, lng: 139.7798 },
        { name: "成田空港", lat: 35.7720, lng: 140.3929 }, { name: "中部國際空港", lat: 34.8584, lng: 136.8053 },
        { name: "伊丹空港", lat: 34.7855, lng: 135.4382 }, { name: "關西國際空港", lat: 34.4320, lng: 135.2304 },
        { name: "廣島空港", lat: 34.4398, lng: 132.9195 }, { name: "福岡空港", lat: 33.5859, lng: 130.4507 },
        { name: "鹿兒島空港", lat: 31.8035, lng: 130.7196 }, { name: "那霸空港", lat: 26.2048, lng: 127.6458 }
    ];

    const mapInstance = ref(null);
    const markers = ref([]);

    const initMap = () => {
        appState.viewMode.value = 'map';
        nextTick(() => {
            const mapContainer = document.getElementById('map');
            if (!mapContainer) return;

            if (!mapInstance.value) {
                mapInstance.value = L.map('map').setView([36.2048, 138.2529], 5);
                L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png', { attribution: '©OpenStreetMap', maxZoom: 18 }).addTo(mapInstance.value);
            }
            setTimeout(() => {
                mapInstance.value.invalidateSize();
                updateMapMarkers();
            }, 200);
        });
    };

    const updateMapMarkers = () => {
        if (!mapInstance.value) return;
        if (markers.value) {
            markers.value.forEach(m => { try { mapInstance.value.removeLayer(m); } catch (e) { } });
        }
        markers.value = [];

        if (!filteredItems.value) return;

        filteredItems.value.forEach(item => {
            const isOwned = item.owned;
            const bgColor = isOwned ? '#4ade80' : '#ffb7ce';
            const contentHtml = item.image ? `<img src="${item.image}" style="width:26px; height:26px; object-fit:contain; border-radius:50%;">` : `<div style="font-size:18px;">${item.emoji}</div>`;
            const customIcon = L.divIcon({ className: 'custom-pin', html: `<div style="background-color: ${bgColor}; width: 36px; height: 36px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 3px solid white; box-shadow: 0 3px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;"><div style="transform: rotate(45deg); display:flex; justify-content:center; align-items:center;">${contentHtml}</div></div>`, iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -40] });

            const airportKeywords = ['空港', 'パイロット', '飛行機', 'CA', 'エアポート'];
            const isAirportItem = airportKeywords.some(kw => item.name.includes(kw));
            const catLabel = item.category === 'tag' ? '鐵牌' : item.category === 'plush' ? '娃娃' : item.category === 'socks' ? '襪子' : '其他';

            const addMarker = (lat, lng, locText) => {
                const marker = L.marker([lat, lng], { icon: customIcon }).bindPopup(`
                    <div style="text-align: center;">
                        <b style="color:#5d4037">${item.name}</b><br>
                        <span style="font-size:12px; color:#888">${locText}<br>${catLabel}</span><br>
                        <button onclick="document.getElementById('toggle-btn-${item.id}').click()" style="margin-top:5px; padding:4px 10px; border-radius:12px; border:none; background:${isOwned ? '#eee' : '#ffb7ce'}; color:${isOwned ? '#888' : 'white'}; cursor:pointer;">${isOwned ? '取消收藏' : '加入收藏'}</button>
                        <button id="toggle-btn-${item.id}" style="display:none"></button>
                    </div>
                `);
                marker.on('popupopen', () => { setTimeout(() => { const btn = document.getElementById(`toggle-btn-${item.id}`); if (btn) btn.onclick = () => { toggleOwn(item); marker.closePopup(); }; }, 0); });
                marker.addTo(mapInstance.value);
                markers.value.push(marker);
            };

            if (isAirportItem && item.region === '其他') {
                MAJOR_AIRPORTS.forEach(airport => addMarker(airport.lat, airport.lng, `📍 ${airport.name}`));
            } else {
                addMarker(item.lat, item.lng, `📍 ${item.search_location || item.region}`);
            }
        });
    };

    return {
        fetchPublicItems, mergeData, filteredItems, ownedCount, progressPercentage,
        toggleOwn, autoUpdate, fixRegions, deletePublicData, resetSelections,
        exportUserData, exportPublicData, downloadJson,
        openImage, closeModal, toggleModalItem, nextImage, prevImage,
        initMap, updateMapMarkers,
        triggerImportUser, importUserData, triggerImportPublic, importPublicData
    };
}