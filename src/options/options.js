const DEFAULT_FILENAME_TEMPLATE = '{username}_{id}_{date}.{extension}';
const STORAGE_KEY = 'filenameTemplate';

function getStorageArea() {
    if (chrome.storage && chrome.storage.sync) return chrome.storage.sync;
    return chrome.storage.local;
}

function setStatus(message) {
    const status = document.querySelector('#status');
    status.textContent = message;
    setTimeout(() => {
        if (status.textContent === message) status.textContent = '';
    }, 1600);
}

async function loadTemplate() {
    const storage = getStorageArea();
    return new Promise((resolve) => {
        storage.get([STORAGE_KEY], (result) => {
            const template = result?.[STORAGE_KEY];
            resolve(typeof template === 'string' && template.trim() ? template : DEFAULT_FILENAME_TEMPLATE);
        });
    });
}

async function saveTemplate(template) {
    const storage = getStorageArea();
    const value = template.trim() ? template.trim() : DEFAULT_FILENAME_TEMPLATE;
    return new Promise((resolve) => {
        storage.set({ [STORAGE_KEY]: value }, () => resolve(value));
    });
}

(async () => {
    const templateInput = document.querySelector('#template');
    const saveButton = document.querySelector('#save');
    const resetButton = document.querySelector('#reset');

    templateInput.value = await loadTemplate();

    saveButton.addEventListener('click', async () => {
        templateInput.value = await saveTemplate(templateInput.value);
        setStatus('Saved');
    });

    resetButton.addEventListener('click', async () => {
        templateInput.value = DEFAULT_FILENAME_TEMPLATE;
        await saveTemplate(templateInput.value);
        setStatus('Reset to default');
    });
})();
