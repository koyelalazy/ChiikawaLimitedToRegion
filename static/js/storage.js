// static/js/storage.js
const USER_SAVE_FILENAME = 'chiikawa_user_save.json';
const DB_FILENAME = 'chiikawa_items.json';

export function setupStorage(appState, AppConfig) {
    const { CLIENT_ID, API_KEY, SCOPES, ADMIN_EMAIL } = AppConfig;

    // --- 🔥 新增：Token 管理邏輯 ---
    const saveGoogleToken = (tokenResponse) => {
        const now = new Date().getTime();
        // 預設 expire_in 是秒，轉毫秒，並提早 1 分鐘視為過期以策安全
        const expiry = now + (tokenResponse.expires_in * 1000) - 60000;
        const sessionData = {
            token: tokenResponse,
            expiry: expiry
        };
        localStorage.setItem('google_access_token', JSON.stringify(sessionData));
    };

    const loadGoogleToken = () => {
        const saved = localStorage.getItem('google_access_token');
        if (!saved) return null;
        try {
            const sessionData = JSON.parse(saved);
            const now = new Date().getTime();
            if (now < sessionData.expiry) {
                return sessionData.token;
            } else {
                // 過期了
                localStorage.removeItem('google_access_token');
                return null;
            }
        } catch (e) { return null; }
    };

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

            const accessToken = gapi.client.getToken().access_token;

            if (files && files.length > 0) {
                // --- 更新現有檔案 (PATCH) ---
                const fileId = files[0].id;
                const updateRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
                    method: 'PATCH',
                    headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
                    body: form
                });
                if (!updateRes.ok) throw new Error("Update failed");
            } else {
                // --- 建立新檔案 (POST) ---
                metadata.parents = [folderId];
                const newForm = new FormData();
                newForm.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
                newForm.append('file', new Blob([content], { type: 'application/json' }));

                const createRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                    method: 'POST',
                    headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
                    body: newForm
                });
                if (!createRes.ok) throw new Error("Create failed");
            }
            console.log("✅ 雲端存檔成功");
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
        localStorage.removeItem('google_access_token');
        alert('已登出');
        loadFromLocal();
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
        saveUserData,
        saveGoogleToken,
        loadGoogleToken
    };
}