// static/js/storage.js
const USER_SAVE_FILENAME = 'chiikawa_user_save.json';
const DB_FILENAME = 'chiikawa_items.json';

export function setupStorage(appState, AppConfig) {
    const { CLIENT_ID, API_KEY, SCOPES, ADMIN_EMAIL } = AppConfig;

    const fetchUserProfile = async (accessToken) => {
        try {
            const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
            const data = await res.json();
            appState.userName.value = data.name;
            appState.userAvatar.value = data.picture;
            if (data.email && ADMIN_EMAIL && data.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
                appState.isAdmin.value = true;
            }
        } catch (e) { console.error("無法取得使用者資料", e); }
    };

    const loadFromDrive = async () => {
        const folderId = appState.folderId.value;
        if (!folderId) return;
        try {
            const q = `'${folderId}' in parents and name = '${USER_SAVE_FILENAME}' and trashed = false`;
            const res = await gapi.client.drive.files.list({ q: q, fields: 'files(id)' });
            const files = res.result.files;

            if (files && files.length > 0) {
                const fileId = files[0].id;
                const fileRes = await gapi.client.drive.files.get({ fileId: fileId, alt: 'media' });
                appState.userStatus.value = fileRes.result || {};
            } else {
                appState.userStatus.value = {};
            }
            // 這裡不直接呼叫 mergeData，而是由 main.js 的 watcher 或 fetchPublicItems 後處理
            // 但如果需要立刻更新畫面，可以回傳 Promise 讓外部處理
        } catch (e) { console.error(e); }
    };

    const saveToDrive = async (data) => {
        const folderId = appState.folderId.value;
        if (!folderId) return;
        try {
            const q = `'${folderId}' in parents and name = '${USER_SAVE_FILENAME}' and trashed = false`;
            const res = await gapi.client.drive.files.list({ q: q, fields: 'files(id)' });
            const files = res.result.files;

            const content = JSON.stringify(data, null, 2);
            const metadata = { name: USER_SAVE_FILENAME, mimeType: 'application/json' };

            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', new Blob([content], { type: 'application/json' }));

            if (files && files.length > 0) {
                const fileId = files[0].id;
                await gapi.client.request({
                    path: `/upload/drive/v3/files/${fileId}`,
                    method: 'PATCH',
                    params: { uploadType: 'multipart' },
                    body: form
                });
            } else {
                metadata.parents = [folderId];
                const newForm = new FormData();
                newForm.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
                newForm.append('file', new Blob([content], { type: 'application/json' }));

                await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                    method: 'POST',
                    headers: new Headers({ 'Authorization': 'Bearer ' + gapi.client.getToken().access_token }),
                    body: newForm
                });
            }
        } catch (e) { console.error("存檔失敗", e); }
    };

    const loadFromLocal = () => {
        const localData = localStorage.getItem('chiikawa_user_save');
        if (localData) { try { appState.userStatus.value = JSON.parse(localData); } catch (e) { appState.userStatus.value = {}; } }
    };

    const saveToLocal = (data) => {
        localStorage.setItem('chiikawa_user_save', JSON.stringify(data));
    };

    const logout = () => {
        const token = gapi.client.getToken();
        if (token !== null) { google.accounts.oauth2.revoke(token.access_token); gapi.client.setToken(''); }
        appState.isLoggedIn.value = false; appState.userName.value = ''; appState.userAvatar.value = ''; appState.folderId.value = ''; appState.folderName.value = ''; appState.isAdmin.value = false;
        appState.userStatus.value = {};
        localStorage.removeItem('drive_folder_id');
        localStorage.removeItem('drive_folder_name');
        alert('已登出');
        loadFromLocal();
        // 這裡需要通知 main.js 重新合併，可以透過回傳 callback 或直接操作 appState (如果傳入的是 ref)
    };

    const saveUserData = () => {
        const data = appState.userStatus.value;
        if (appState.isLoggedIn.value && appState.folderId.value) saveToDrive(data);
        else saveToLocal(data);
    };

    return {
        fetchUserProfile,
        loadFromDrive,
        saveToDrive,
        loadFromLocal,
        saveToLocal,
        logout,
        saveUserData
    };
}