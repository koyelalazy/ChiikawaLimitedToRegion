// static/js/main.js
import { setupStorage } from './storage.js';
import { setupUI } from './ui.js';

const { createApp, ref, onMounted, watch } = Vue;

const appState = {
    publicItems: ref([]),
    userStatus: ref({}),
    items: ref([]),
    viewMode: ref('list'),
    selectedRegion: ref('全部'),
    selectedCategory: ref('all'),
    statusFilter: ref('all'),
    showSettingsModal: ref(false),
    isUpdating: ref(false),
    showModal: ref(false),
    currentModalIndex: ref(0),
    modalItem: ref({}),
    modalImage: ref(''),
    modalTitle: ref(''),
    modalSubtitle: ref(''),
    isLoggedIn: ref(false),
    isAdmin: ref(false),
    userName: ref(''),
    userAvatar: ref(''),
    folderName: ref(''),
    folderId: ref(''),
    tempFolderName: ref(''),
    mapInstance: ref(null),
    markers: ref([])
};

createApp({
    setup() {
        const { CLIENT_ID, API_KEY, SCOPES } = AppConfig;

        const storage = setupStorage(appState, AppConfig);
        const ui = setupUI(appState, AppConfig, storage, Vue);

        let tokenClient;
        const handleAuthClick = () => {
            if (tokenClient) {
                tokenClient.requestAccessToken({ prompt: 'consent' });
            } else {
                console.log("Google Auth SDK 尚未載入完成，請稍候...");
            }
        };

        const onGapiLoad = () => {
            gapi.load('client:picker', async () => {
                await gapi.client.init({ apiKey: API_KEY, discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'] });

                // 🔥 自動登入邏輯
                const savedToken = storage.loadGoogleToken();
                if (savedToken) {
                    console.log("發現有效 Token，自動登入中...");
                    gapi.client.setToken(savedToken);
                    appState.isLoggedIn.value = true;
                    storage.fetchUserProfile(savedToken.access_token);
                    if (appState.folderId.value) {
                        storage.loadFromDrive();
                    }
                }
            });
        };

        const onGisLoad = () => {
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID, scope: SCOPES,
                callback: async (resp) => {
                    if (resp.error !== undefined) throw (resp);

                    storage.saveGoogleToken(resp);

                    appState.isLoggedIn.value = true;
                    storage.fetchUserProfile(resp.access_token);
                    if (!appState.folderId.value) ui.openPicker();
                    else storage.loadFromDrive();
                },
            });
        };

        ui.openPicker = () => {
            const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS).setMimeTypes('application/vnd.google-apps.folder').setSelectFolderEnabled(true);
            const picker = new google.picker.PickerBuilder().enableFeature(google.picker.Feature.NAV_HIDDEN).setDeveloperKey(API_KEY).setAppId(CLIENT_ID).setOAuthToken(gapi.client.getToken().access_token).addView(view).setCallback(pickerCallback).build();
            picker.setVisible(true);
        };
        const pickerCallback = (data) => {
            if (data.action === google.picker.Action.PICKED) {
                const doc = data.docs[0]; appState.folderId.value = doc.id; appState.folderName.value = doc.name;
                localStorage.setItem('drive_folder_id', doc.id); localStorage.setItem('drive_folder_name', doc.name);
                alert(`已選擇資料夾: ${doc.name}`);
                storage.loadFromDrive();
            }
        };

        const openSettings = () => { appState.tempFolderName.value = appState.folderName.value; appState.showSettingsModal.value = true; };
        const saveSettings = () => { if (appState.isLoggedIn.value) { ui.openPicker(); } else { alert("請先登入 Google"); } appState.showSettingsModal.value = false; };

        watch([appState.selectedRegion, appState.selectedCategory, appState.statusFilter], () => { if (appState.viewMode.value === 'map') ui.initMap(); });
        watch(
            () => appState.userStatus.value,
            (newVal) => {
                console.log("使用者資料已更新，重新合併畫面...");
                ui.mergeData();
            },
            { deep: true }
        );

        onMounted(() => {
            const script1 = document.createElement('script'); script1.src = "https://apis.google.com/js/api.js"; script1.onload = onGapiLoad; document.body.appendChild(script1);
            const script2 = document.createElement('script'); script2.src = "https://accounts.google.com/gsi/client"; script2.onload = onGisLoad; document.body.appendChild(script2);

            const savedFolderId = localStorage.getItem('drive_folder_id');
            const savedFolderName = localStorage.getItem('drive_folder_name');
            if (savedFolderId) { appState.folderId.value = savedFolderId; appState.folderName.value = savedFolderName; }

            storage.loadFromLocal();
            ui.fetchPublicItems();

            const scrollContainer = document.getElementById('region-scroll-area');
            if (scrollContainer) {
                scrollContainer.addEventListener('wheel', (evt) => {
                    if (evt.deltaY !== 0 && window.innerWidth > 768) {
                        evt.preventDefault();
                        scrollContainer.scrollLeft += evt.deltaY;
                    }
                });
            }
        });

        return {
            ...appState,
            ...ui,
            ...storage,
            openSettings, saveSettings,
            handleAuthClick
        };
    }
}).mount('#app');