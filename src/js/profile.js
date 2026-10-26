// First path segment of these routes is not a username
const IG_RESERVED_PATHS = ['explore', 'reels', 'direct', 'accounts', 'stories', 'p', 'tv', 'reel'];
const IG_PROFILE_REGEX = /^\/([A-Za-z0-9._]+)(\/(reels|tagged|saved))?\/?$/;

/**
 * Cache profile picture, avoid calling rate limited api again
 *
 * username => { url, id }
 */
const profilePictureCache = new Map();

function getProfileUsernameFromPath(path = window.location.pathname) {
    const profilePage = path.match(IG_PROFILE_REGEX);
    if (!profilePage || IG_RESERVED_PATHS.includes(profilePage[1])) return '';
    return profilePage[1];
}

/**
 * Ask profile-view-handler.js (MAIN world) for user info already loaded by Instagram.
 * Event is dispatch synchronously, timeout only in case handler not loaded.
 */
function getProfileInfoFromPage(username) {
    return new Promise(resolve => {
        function handleResponse(e) {
            if (e.detail?.username !== username) return;
            clearTimeout(timeoutId);
            window.removeEventListener('profileInfoResponse', handleResponse);
            resolve(e.detail);
        }
        const timeoutId = setTimeout(() => {
            window.removeEventListener('profileInfoResponse', handleResponse);
            resolve(null);
        }, 1000);
        window.addEventListener('profileInfoResponse', handleResponse);
        window.dispatchEvent(new CustomEvent('profileInfoRequest', { detail: username }));
    });
}

async function fetchProfileJson(url) {
    const respone = await fetch(url, getFetchOptions());
    if (!respone.ok) {
        const error = new Error(`Request failed with status ${respone.status}`);
        error.status = respone.status;
        throw error;
    }
    return respone.json();
}

/**
 * Api calls only happen when page data is missing:
 * no hd url => user info api, no user id => web_profile_info (heavily rate limited) too.
 */
async function getProfilePicture(username) {
    if (profilePictureCache.has(username)) return profilePictureCache.get(username);
    const pageInfo = await getProfileInfoFromPage(username);
    let id = pageInfo?.id || appCache.userIdsCache.get(username) || '';
    if (pageInfo?.url) {
        const picture = { url: pageInfo.url, id };
        profilePictureCache.set(username, picture);
        return picture;
    }
    let fallbackUrl = '';
    if (!id) {
        const apiURL = new URL('/api/v1/users/web_profile_info/', IG_BASE_URL);
        apiURL.searchParams.set('username', username);
        const json = await fetchProfileJson(apiURL.href);
        id = json.data.user.id;
        fallbackUrl = json.data.user.profile_pic_url_hd || json.data.user.profile_pic_url;
    }
    if (!appCache.userIdsCache.has(username)) appCache.userIdsCache.set(username, id);
    // User info api return the original size, web_profile_info only return 320px
    const infoURL = new URL(`/api/v1/users/${id}/info/`, IG_BASE_URL);
    const json = await fetchProfileJson(infoURL.href);
    const url = json.user?.hd_profile_pic_url_info?.url || json.user?.profile_pic_url || fallbackUrl;
    const picture = { url, id };
    if (url) profilePictureCache.set(username, picture);
    return picture;
}

/**
 * UTC time as YYYYMMDDHHmmssZ, timezone agnostic and sort in chronological order
 */
function formatCompactTimestamp(date) {
    // 2026-10-25T22:53:01.000Z => 20261025225301Z
    return date.toISOString().replace(/[-:T]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function resetProfilePictureState(text = 'Profile Pic') {
    const PROFILE_PIC_BUTTON = document.querySelector('.download-profile-pic-button');
    if (!PROFILE_PIC_BUTTON) return;
    PROFILE_PIC_BUTTON.classList.remove('loading');
    PROFILE_PIC_BUTTON.textContent = text;
    PROFILE_PIC_BUTTON.disabled = false;
}

async function saveProfilePicture() {
    const PROFILE_PIC_BUTTON = document.querySelector('.download-profile-pic-button');
    if (!PROFILE_PIC_BUTTON) return;
    const username = getProfileUsernameFromPath();
    if (!username) return;
    PROFILE_PIC_BUTTON.classList.add('loading');
    PROFILE_PIC_BUTTON.textContent = 'Loading...';
    PROFILE_PIC_BUTTON.disabled = true;
    try {
        const picture = await getProfilePicture(username);
        if (!picture.url) return resetProfilePictureState();
        const response = await fetch(picture.url);
        const blob = await response.blob();
        // Profile picture have no date, use download date instead
        const now = new Date();
        const filenameTemplate = await getFilenameTemplate();
        const fileName = getDownloadFileName(filenameTemplate, {
            username,
            // Used to import profile picture, keep format: userId_YYYYMMDDHHmmssZ
            hash: `${picture.id}_${formatCompactTimestamp(now)}`,
            id: 'profile_picture',
            date: now.toISOString().split('T')[0],
            time: now.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' }),
            index: '',
            extension: 'jpeg',
            isCarousel: false
        });
        saveFile(blob, fileName);
        resetProfilePictureState();
    } catch (error) {
        console.log(error);
        if (error.status !== 429) return resetProfilePictureState();
        resetProfilePictureState('Rate limited');
        // Keep disabled for a while, retry right away only make it worse
        PROFILE_PIC_BUTTON.disabled = true;
        setTimeout(() => { resetProfilePictureState(); }, 3000);
    }
}
