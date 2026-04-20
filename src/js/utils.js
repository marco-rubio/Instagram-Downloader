function saveFile(blob, fileName) {
    const a = document.createElement('a');
    a.download = fileName;
    a.href = URL.createObjectURL(blob);
    a.click();
    URL.revokeObjectURL(a.href);
}

function getCookieValue(name) {
    return document.cookie.split('; ')
        .find(row => row.startsWith(`${name}=`))
        ?.split('=')[1];
}

function getFetchOptions() {
    return {
        headers: {
            // Hardcode variable: a="129477";f.ASBD_ID=a in JS, can be remove
            // 'x-asbd-id': '129477',
            'x-csrftoken': getCookieValue('csrftoken'),
            'x-ig-app-id': '936619743392459',
            'x-ig-www-claim': sessionStorage.getItem('www-claim-v2'),
            // 'x-instagram-ajax': '1006598911',
            'x-requested-with': 'XMLHttpRequest'
        },
        referrer: window.location.href,
        referrerPolicy: 'strict-origin-when-cross-origin',
        method: 'GET',
        mode: 'cors',
        credentials: 'include'
    };
}

const postDescriptionDownloadText = new WeakMap();
const mediaDownloadMeta = new WeakMap();
const DEFAULT_FILENAME_TEMPLATE = '{username}_{id}_{date}.{extension}';
const FILENAME_TEMPLATE_STORAGE_KEY = 'filenameTemplate';
let cachedFilenameTemplate = null;

if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes) => {
        if (!changes[FILENAME_TEMPLATE_STORAGE_KEY]) return;
        const nextValue = changes[FILENAME_TEMPLATE_STORAGE_KEY].newValue;
        cachedFilenameTemplate = typeof nextValue === 'string' && nextValue.trim()
            ? nextValue
            : DEFAULT_FILENAME_TEMPLATE;
    });
}

function getStorageArea() {
    if (chrome.storage && chrome.storage.sync) return chrome.storage.sync;
    return chrome.storage.local;
}

async function getFilenameTemplate() {
    if (typeof cachedFilenameTemplate === 'string') return cachedFilenameTemplate;
    const storage = getStorageArea();
    return new Promise((resolve) => {
        storage.get([FILENAME_TEMPLATE_STORAGE_KEY], (result) => {
            const template = result?.[FILENAME_TEMPLATE_STORAGE_KEY];
            cachedFilenameTemplate = typeof template === 'string' && template.trim()
                ? template
                : DEFAULT_FILENAME_TEMPLATE;
            resolve(cachedFilenameTemplate);
        });
    });
}

function sanitizeFilename(name, fallback = 'download') {
    const sanitized = name
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/g, '');
    return sanitized || fallback;
}

function renderFilenameTemplate(template, context) {
    const carouselParsed = template.replace(/\{isCarousel\}([\s\S]*?)\{\/isCarousel\}/g, (_match, content) => {
        return context.isCarousel ? content : '';
    });
    const filename = carouselParsed.replace(/\{([a-zA-Z]+)\}/g, (_match, token) => {
        if (!(token in context)) return '';
        const value = context[token];
        return value === null || value === undefined ? '' : String(value);
    });
    return sanitizeFilename(filename);
}

function getDownloadFileName(template, context) {
    return renderFilenameTemplate(template, {
        username: context.username ?? '',
        hash: context.hash ?? '',
        id: context.id ?? '',
        date: context.date ?? '',
        time: context.time ?? '',
        index: context.index ?? '',
        extension: context.extension ?? '',
        isCarousel: Boolean(context.isCarousel),
    });
}

function getValueByKey(obj, key) {
    if (typeof obj !== 'object' || obj === null) return null;
    const stack = [obj];
    const visited = new Set();
    while (stack.length) {
        const current = stack.pop();
        if (visited.has(current)) continue;
        visited.add(current);
        try {
            if (current[key] !== undefined) return current[key];
        } catch (error) {
            if (error.name === 'SecurityError') continue;
            console.log(error);
        }
        for (const value of Object.values(current)) {
            if (typeof value === 'object' && value !== null) {
                stack.push(value);
            }
        }
    }
    return null;
};

function resetDownloadState() {
    const DOWNLOAD_BUTTON = document.querySelector('.download-button');
    DOWNLOAD_BUTTON.classList.remove('loading');
    DOWNLOAD_BUTTON.textContent = 'Download';
    DOWNLOAD_BUTTON.disabled = false;
}

async function saveMedia(media, fileName) {
    try {
        const respone = await fetch(media.src);
        const blob = await respone.blob();
        saveFile(blob, fileName);
    } catch (error) {
        console.log(error);
    }
}

async function saveZip() {
    const DOWNLOAD_BUTTON = document.querySelector('.download-button');
    DOWNLOAD_BUTTON.classList.add('loading');
    DOWNLOAD_BUTTON.textContent = 'Loading...';
    DOWNLOAD_BUTTON.disabled = true;
    const selectedMedia = Array.from(document.querySelectorAll('.overlay.checked')).map(item => item.previousElementSibling);
    if (selectedMedia.length === 0) return resetDownloadState();
    const firstItemName = selectedMedia[0].dataset.downloadName || 'download';
    const firstItemMeta = mediaDownloadMeta.get(selectedMedia[0]) || {};
    const zipBaseName = firstItemMeta.zipBaseName || firstItemName.replace(/\.[^./\\]+$/, '');
    const zipFileName = `${sanitizeFilename(zipBaseName, 'download')}.zip`;
    async function fetchSelectedMedia() {
        let count = 0;
        const results = await Promise.allSettled(selectedMedia.map(async (media) => {
            const meta = mediaDownloadMeta.get(media) || {};
            if (media.classList.contains('post-description-item')) {
                const text = postDescriptionDownloadText.get(media) ?? '';
                const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                const data = {
                    title: meta.fileName || media.dataset.downloadName || 'description.txt',
                    data: blob
                };
                count++;
                DOWNLOAD_BUTTON.textContent = `${count}/${selectedMedia.length}`;
                return data;
            }
            const res = await fetch(media.src);
            const blob = await res.blob();
            const data = {
                title: meta.fileName || media.dataset.downloadName || 'media',
                data: blob
            };
            count++;
            DOWNLOAD_BUTTON.textContent = `${count}/${selectedMedia.length}`;
            return data;
        }));
        results.forEach(promise => {
            if (promise.status === 'rejected') throw new Error('Fail to fetch');
        });
        return results.map(promise => promise.value);
    }
    try {
        const media = await fetchSelectedMedia();
        const blob = await createZip(media);
        saveFile(blob, zipFileName);
        document.querySelectorAll('.overlay').forEach(element => {
            element.classList.remove('checked');
        });
        resetDownloadState();
    } catch (error) {
        console.log(error);
        resetDownloadState();
    }
}

function shouldDownload() {
    if (window.location.pathname === '/' && appState.getFieldChange() !== 'none') {
        return appState.getFieldChange();
    }
    appState.setCurrentShortcode();
    appState.setCurrentUsername();
    appState.setCurrentHightlightsId();
    function getCurrentPage() {
        const currentPath = window.location.pathname;
        if (currentPath.match(IG_POST_REGEX)) return 'post';
        if (currentPath.match(IG_STORY_REGEX)) {
            if (currentPath.match(IG_HIGHLIGHT_REGEX)) return 'highlights';
            return 'stories';
        }
        if (currentPath === '/') return 'post';
        return 'none';
    }
    const currentPage = getCurrentPage();
    const valueChange = appState.getFieldChange();
    if (['highlights', 'stories', 'post'].includes(currentPage)) {
        if (currentPage === valueChange) return valueChange;
        if (appState.currentDisplay !== currentPage) return currentPage;
    }
    return 'none';
}

function setDownloadState(state = 'ready') {
    const DOWNLOAD_BUTTON = document.querySelector('.download-button');
    const MEDIA_CONTAINER = document.querySelector('.media-container');
    const options = {
        ready() {
            DOWNLOAD_BUTTON.classList.add('loading');
            DOWNLOAD_BUTTON.textContent = 'Loading...';
            DOWNLOAD_BUTTON.disabled = true;
            MEDIA_CONTAINER.replaceChildren();
        },
        fail() { resetDownloadState(); },
        success() {
            DOWNLOAD_BUTTON.disabled = false;
            appState.setPreviousValues();
            const photosArray = MEDIA_CONTAINER.querySelectorAll('img , video');
            let loadedPhotos = 0;
            function countLoaded() {
                loadedPhotos++;
                if (loadedPhotos === photosArray.length) resetDownloadState();
            }
            photosArray.forEach(media => {
                if (media.tagName === 'IMG') {
                    media.addEventListener('load', countLoaded);
                    media.addEventListener('error', countLoaded);
                }
                else {
                    media.addEventListener('loadeddata', countLoaded);
                    media.addEventListener('abort', countLoaded);
                }
            });
        }
    };
    options[state]();
}

async function handleDownload() {
    let data = null;
    const TITLE_CONTAINER = document.querySelector('.title-container').firstElementChild;
    const DISPLAY_CONTAINER = document.querySelector('.display-container');
    const option = shouldDownload();
    const totalItemChecked = Array.from(document.querySelectorAll('.overlay.checked'));
    if (TITLE_CONTAINER.classList.contains('multi-select')
        && !DISPLAY_CONTAINER.classList.contains('hide')
        && option === 'none'
        && totalItemChecked.length !== 0) {
        return saveZip();
    }
    requestAnimationFrame(() => { DISPLAY_CONTAINER.classList.remove('hide'); });
    if (option === 'none') return;
    setDownloadState('ready');
    option === 'post' ? data = await downloadPostPhotos() : data = await downloadStoryPhotos(option);
    if (!data) return setDownloadState('fail');
    appState.currentDisplay = option;
    renderMedia(data);
}

async function renderMedia(data) {
    const TITLE_CONTAINER = document.querySelector('.title-container').firstElementChild;
    const MEDIA_CONTAINER = document.querySelector('.media-container');
    MEDIA_CONTAINER.replaceChildren();
    if (!data) return;
    const fragment = document.createDocumentFragment();
    const postDate = new Date(data.date * 1000);
    const date = postDate.toISOString().split('T')[0];
    const time = postDate.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' });
    const filenameTemplate = await getFilenameTemplate();
    const mediaCount = data.media.length;
    const zipBaseName = getDownloadFileName(filenameTemplate, {
        username: data.user.username,
        hash: data.hash || '',
        id: data.media[0]?.id || '',
        date,
        time,
        index: '',
        extension: '',
        isCarousel: false
    });
    data.media.forEach((item, mediaIndex) => {
        const attributes = {
            class: 'media-item',
            src: item.url,
            controls: ''
        };
        const extension = item.isVideo ? 'mp4' : 'jpeg';
        const fileName = getDownloadFileName(filenameTemplate, {
            username: data.user.username,
            hash: data.hash || '',
            id: item.id,
            date,
            time,
            index: mediaIndex + 1,
            extension,
            isCarousel: mediaCount > 1
        });
        const ITEM_TEMPLATE =
            `<div>
				${item.isVideo ? `<video></video>` : '<img/>'}
				<div class="overlay">✔</div>
			</div>`;
        const itemDOM = new DOMParser().parseFromString(ITEM_TEMPLATE, 'text/html').body.firstElementChild;
        const media = itemDOM.querySelector('img, video');
        const selectBox = itemDOM.querySelector('.overlay');
        Object.keys(attributes).forEach(key => {
            if (item.isVideo) media.setAttribute(key, attributes[key]);
            else if (key !== 'controls') media.setAttribute(key, attributes[key]);
        });
        media.dataset.downloadName = fileName;
        mediaDownloadMeta.set(media, { fileName, zipBaseName });
        media.addEventListener('click', (e) => {
            if (TITLE_CONTAINER.classList.contains('multi-select')) {
                if (item.isVideo) e.preventDefault();
                selectBox.classList.toggle('checked');
            }
            else saveMedia(media, fileName);
        });
        fragment.appendChild(itemDOM);
    });
    if (data.caption) {
        const descriptionFileName = getDownloadFileName(filenameTemplate, {
            username: data.user.username,
            hash: data.hash || '',
            id: 'description',
            date,
            time,
            index: '',
            extension: 'txt',
            isCarousel: false
        });
        const DESCRIPTION_TEMPLATE =
            `<div>
				<div class="media-item post-description-item"></div>
				<div class="overlay">✔</div>
			</div>`;
        const itemDOM = new DOMParser().parseFromString(DESCRIPTION_TEMPLATE, 'text/html').body.firstElementChild;
        const descriptionEl = itemDOM.querySelector('.post-description-item');
        const selectBox = itemDOM.querySelector('.overlay');
        descriptionEl.dataset.downloadName = descriptionFileName;
        descriptionEl.textContent = data.caption;
        postDescriptionDownloadText.set(descriptionEl, data.caption);
        mediaDownloadMeta.set(descriptionEl, { fileName: descriptionFileName, zipBaseName });
        descriptionEl.addEventListener('click', (e) => {
            if (TITLE_CONTAINER.classList.contains('multi-select')) {
                selectBox.classList.toggle('checked');
            }
            else {
                saveFile(
                    new Blob([postDescriptionDownloadText.get(descriptionEl) ?? ''], { type: 'text/plain;charset=utf-8' }),
                    descriptionFileName
                );
            }
        });
        fragment.appendChild(itemDOM);
    }
    MEDIA_CONTAINER.appendChild(fragment);
    TITLE_CONTAINER.classList.remove('multi-select');
    setDownloadState('success');
}

function handleLongClick(element, shortClickHandler, longClickHandler, delay = 400) {
    element.addEventListener('mousedown', (e) => {
        if (e.button === 2) return;
        let count = 0;
        const intervalId = setInterval(() => {
            count = count + 10;
            if (count >= delay) {
                clearInterval(intervalId);
                longClickHandler();
            }
        }, 10);
        element.addEventListener('mouseup', () => {
            clearInterval(intervalId);
            if (count < delay) shortClickHandler();
        }, { once: true });
    });
}

function isValidJson(string) {
    try {
        JSON.parse(string);
        return true;
    } catch {
        return false;
    }
}