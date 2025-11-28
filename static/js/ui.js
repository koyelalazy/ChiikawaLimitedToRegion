// static/js/ui.js

export function setupUI(appState, AppConfig, storageFunctions, Vue) {
    const { ref, computed, watch, nextTick, markRaw } = Vue;

    // --- API 呼叫 ---
    const apiCall = async (url, method = 'GET', body = null) => {
        const headers = { 'Content-Type': 'application/json' };
        const config = { method, headers };
        if (body) config.body = JSON.stringify(body);

        try {
            const res = await fetch(url, config);
            const result = await res.json();
            if (result.status === 'error') throw new Error(result.message || "API 請求錯誤");
            return result;
        } catch (e) {
            console.error("API Error:", e);
            alert(`操作失敗: ${e.message}`);
            throw e;
        }
    };

    const mergeData = () => {
        if (!appState.publicItems.value || !Array.isArray(appState.publicItems.value)) {
            appState.items.value = [];
            return;
        }
        appState.items.value = appState.publicItems.value.map(pItem => {
            const key = pItem.image ? pItem.image.split('/').pop() : pItem.name;
            const uStat = appState.userStatus.value[key] || {};
            return { ...pItem, owned: uStat.owned || false };
        });
        if (appState.viewMode.value === 'map') updateMapMarkers();
    };

    const fetchPublicItems = async () => {
        try {
            const result = await apiCall('/api/public_items');
            appState.publicItems.value = Array.isArray(result) ? result : [];
            mergeData();
            if (appState.viewMode.value === 'map') initMap();
        } catch (e) { /*...*/ }
    };

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
    const progressPercentage = computed(() => appState.items.value.length ? (ownedCount.value / appState.items.value.length) * 100 : 0);

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
            appState.publicItems.value = res.data;
            mergeData();
            const totalCount = res.total !== undefined ? res.total : (res.data ? res.data.length : 0);
            alert(`更新完成！共 ${totalCount} 筆商品。`);
        } catch (e) { /*...*/ }
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
        } catch (e) {
            console.error(e);
            alert("修正失敗");
        }
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
                storageFunctions.saveUserData();
                mergeData();
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
        mergeData();
        storageFunctions.saveUserData();
    };

    const toggleModalItem = () => { if (appState.modalItem.value) toggleOwn(appState.modalItem.value); };
    const updateModalContent = () => {
        if (!filteredItems.value.length) return;
        const item = filteredItems.value[appState.currentModalIndex.value];
        if (item) {
            appState.modalImage.value = item.image;
            appState.modalTitle.value = item.name;
            appState.modalSubtitle.value = `${item.region} | ${item.category}`;
            appState.modalItem.value = item;
        }
    };
    const openImage = (item, index) => { appState.currentModalIndex.value = index; updateModalContent(); appState.showModal.value = true; };
    const closeModal = () => appState.showModal.value = false;
    const nextImage = () => { if (appState.currentModalIndex.value < filteredItems.value.length - 1) { appState.currentModalIndex.value++; updateModalContent(); } };
    const prevImage = () => { if (appState.currentModalIndex.value > 0) { appState.currentModalIndex.value--; updateModalContent(); } };

    // --- Map ---
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

            if (!appState.mapInstance.value) {
                appState.mapInstance.value = markRaw(L.map('map').setView([36.2048, 138.2529], 5));
                L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png', { attribution: '©OpenStreetMap', maxZoom: 18 }).addTo(appState.mapInstance.value);
            }
            setTimeout(() => {
                appState.mapInstance.value.invalidateSize();
                updateMapMarkers();
            }, 200);
        });
    };

    const updateMapMarkers = () => {
        if (!appState.mapInstance.value) return;
        if (appState.markers.value) {
            appState.markers.value.forEach(m => { try { appState.mapInstance.value.removeLayer(m); } catch (e) { } });
        }
        appState.markers.value = [];

        if (!filteredItems.value || !Array.isArray(filteredItems.value)) return;

        // 1. 分組 (Grouping by coordinates)
        const locationGroups = {};

        // 🔥 修改 1：addToGroup 改為儲存物件 {item, index}
        const addToGroup = (lat, lng, itemData, locName) => {
            const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
            if (!locationGroups[key]) {
                locationGroups[key] = { lat, lng, locName, items: [] };
            }
            locationGroups[key].items.push(itemData);
        };

        // 🔥 修改 2：遍歷時同時取得 item 和 originalIndex
        filteredItems.value.forEach((item, originalIndex) => {
            const airportKeywords = ['空港', 'パイロット', '飛行機', 'CA', 'エアポート'];
            const isAirportItem = airportKeywords.some(kw => item.name.includes(kw));

            if (isAirportItem && item.region === '其他') {
                MAJOR_AIRPORTS.forEach(airport => {
                    // 傳入包含 index 的物件
                    addToGroup(airport.lat, airport.lng, { item, index: originalIndex }, `${airport.name} (全日本機場)`);
                });
            } else {
                addToGroup(item.lat, item.lng, { item, index: originalIndex }, item.search_location || item.region);
            }
        });

        // 2. 繪製 Marker
        Object.values(locationGroups).forEach(group => {
            // 注意：現在 group.items 裡面是 {item, index} 的物件
            const allOwned = group.items.every(wrapper => wrapper.item.owned);
            const anyOwned = group.items.some(wrapper => wrapper.item.owned);

            let bgColor = '#ffb7ce';
            if (allOwned) bgColor = '#4ade80';
            else if (anyOwned) bgColor = '#facc15';

            let contentHtml = '';
            if (group.items.length === 1) {
                const item = group.items[0].item;
                contentHtml = item.image ? `<img src="${item.image}" style="width:26px; height:26px; object-fit:contain; border-radius:50%;">` : `<div style="font-size:18px;">${item.emoji}</div>`;
            } else {
                contentHtml = `<div style="font-size:14px; font-weight:bold; color:white;">${group.items.length}</div>`;
            }

            const customIcon = L.divIcon({
                className: 'custom-pin',
                html: `<div style="background-color: ${bgColor}; width: 36px; height: 36px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 3px solid white; box-shadow: 0 3px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;">
                        <div style="transform: rotate(45deg); display:flex; justify-content:center; align-items:center;">${contentHtml}</div>
                       </div>`,
                iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -40]
            });

            const marker = markRaw(L.marker([group.lat, group.lng], { icon: customIcon }));

            // 3. 產生 Popup 內容
            let popupHtml = `<div style="text-align: center; margin-bottom:5px;"><b>📍 ${group.locName}</b></div>`;
            popupHtml += `<div class="map-list-container">`;

            // 🔥 修改 3：解構取得 item 和 index，並為圖片添加可點擊的 ID 和樣式
            group.items.forEach(({ item, index: originalIndex }) => {
                const isOwned = item.owned;
                const btnColor = isOwned ? '#eee' : '#ffb7ce';
                const btnText = isOwned ? '#888' : 'white';
                const btnLabel = isOwned ? '取消' : '收藏';
                const imgTag = item.image ? `<img src="${item.image}" class="map-list-img">` : `<span style="font-size:20px; display:inline-block; width:40px; text-align:center;">${item.emoji}</span>`;

                // 產生唯一的 ID 用於綁定點擊事件
                const imgBtnId = `map-item-img-${item.id}-${group.lat.toFixed(5)}`;
                const toggleBtnId = `toggle-btn-${item.id}-${group.lat.toFixed(5)}`;

                popupHtml += `
                    <div class="map-list-item">
                        <div id="${imgBtnId}" style="cursor:pointer;" title="點擊查看大圖">
                            ${imgTag}
                        </div>
                        <div style="flex:1; text-align:left; overflow:hidden; margin-left: 8px;">
                            <div style="font-size:12px; font-weight:bold; color:#5d4037; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.name}</div>
                            <div style="font-size:10px; color:#888;">${item.category}</div>
                        </div>
                        <button id="${toggleBtnId}" style="padding:4px 8px; border-radius:6px; border:none; background:${btnColor}; color:${btnText}; font-size:10px; cursor:pointer; white-space:nowrap;">
                            ${btnLabel}
                        </button>
                    </div>
                `;
            });
            popupHtml += `</div>`;

            marker.bindPopup(popupHtml, { maxWidth: 300 });

            // 4. 綁定事件
            marker.on('popupopen', () => {
                // 🔥 修改 4：同時綁定圖片點擊和按鈕點擊事件
                group.items.forEach(({ item, index: originalIndex }) => {
                    const imgBtnId = `map-item-img-${item.id}-${group.lat.toFixed(5)}`;
                    const toggleBtnId = `toggle-btn-${item.id}-${group.lat.toFixed(5)}`;

                    setTimeout(() => {
                        // 綁定圖片點擊 -> 開啟大圖
                        const imgBtn = document.getElementById(imgBtnId);
                        if (imgBtn) {
                            imgBtn.onclick = (e) => {
                                e.stopPropagation();
                                openImage(item, originalIndex);
                            };
                        }

                        // 綁定按鈕點擊 -> 切換收藏
                        const toggleBtn = document.getElementById(toggleBtnId);
                        if (toggleBtn) {
                            toggleBtn.onclick = (e) => {
                                e.stopPropagation();
                                toggleOwn(item);
                                marker.closePopup();
                                marker.openPopup();
                            };
                        }
                    }, 0);
                });
            });

            marker.addTo(appState.mapInstance.value);
            appState.markers.value.push(marker);
        });
    };

    return {
        fetchPublicItems, mergeData, filteredItems, ownedCount, progressPercentage,
        toggleOwn, autoUpdate, fixRegions, deletePublicData, resetSelections,
        exportUserData, exportPublicData, downloadJson,
        openImage, closeModal, toggleModalItem, nextImage, prevImage,
        initMap, updateMapMarkers,
        triggerImportUser, importUserData, triggerImportPublic, importPublicData,
        categories: [{ key: 'all', label: '全部' }, { key: 'tag', label: '鐵牌' }, { key: 'plush', label: '娃娃' }, { key: 'socks', label: '襪子' }, { key: 'other', label: '其他' }],
        regions: ['全部', '北海道', '東北', '關東', '中部', '近畿', '中國', '四國', '九州', '沖繩', '海外', '其他']
    };
}