/**
 * Push of export ZIPs to the instagram-archive app's local server, and its settings,
 * see openspec/changes/push-to-archive-app.
 *
 * igexport.js calls igexportPush.getSettings() and igexportPush.push(); with no token saved,
 * exports are downloaded as before. Settings live in chrome.storage.local, never in the page's
 * localStorage (Instagram's scripts can read that one, the token must not be there).
 */
const igexportPush = Object.freeze(
    (() => {
        const STORAGE_KEY = 'igexportPush';
        const DEFAULT_ENDPOINT = 'http://127.0.0.1:47821';
        // Marco's budget ladder: no header first (the app's default), then these, on a "too-large" refusal.
        const BUDGET_STEPS = [null, 268435456, 536870912];
        // The app answers only once the capture is imported, which takes a while for a large video.
        const INGEST_TIMEOUT = 10 * 60 * 1000;
        const HEALTH_TIMEOUT = 5000;
        const NAV_ITEM_CLASS = 'igd-export-settings-nav-item';
        const MODAL_CLASS = 'igd-export-settings-modal';
        const UPSTREAM_NAV_ITEM_CLASS = 'igd-settings-nav-item';
        const MESSAGES = Object.freeze({
            unreachable: 'The archive app could not be reached.',
            timeout: 'The archive app did not answer in time.',
            unauthorized: 'The archive app refused the token; check it in the export settings.',
        });
        let health = null;
        let updateQueued = false;

        class PushError extends Error {}

        function normalizeSettings(value) {
            return {
                endpoint: String(value?.endpoint || DEFAULT_ENDPOINT).trim(),
                token: String(value?.token || '').trim(),
            };
        }

        async function readSettings() {
            const stored = await chrome.storage.local.get(STORAGE_KEY);
            return normalizeSettings(stored[STORAGE_KEY]);
        }

        // Pushing is on only with a token saved: no token means plain downloads, as before.
        async function getSettings() {
            const settings = await readSettings();
            return settings.endpoint && settings.token ? settings : null;
        }

        function endpointUrl(settings, path) {
            return `${settings.endpoint.replace(/\/+$/, '')}${path}`;
        }

        function parseJson(text) {
            try {
                const value = JSON.parse(text);
                return value && typeof value === 'object' ? value : null;
            } catch {
                return null;
            }
        }

        // XHR, not fetch: only XHR reports upload progress over HTTP/1.1 and in Firefox.
        function sendRequest({ method, url, token, headers = {}, body = null, timeout, onUploadProgress }) {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open(method, url);
                xhr.timeout = timeout;
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
                Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
                if (onUploadProgress) {
                    xhr.upload.addEventListener('progress', (event) => {
                        if (event.lengthComputable) onUploadProgress(event.loaded / event.total);
                    });
                }
                xhr.addEventListener('load', () => resolve({ status: xhr.status, json: parseJson(xhr.responseText) }));
                xhr.addEventListener('error', () => reject(new PushError(MESSAGES.unreachable)));
                xhr.addEventListener('timeout', () => reject(new PushError(MESSAGES.timeout)));
                xhr.send(body);
            });
        }

        // The app's own sentence when it gave one, ours otherwise; unknown refusals are not special.
        function refusalError(status, json) {
            if (status === 401 || json?.refusal === 'unauthorized') return new PushError(MESSAGES.unauthorized);
            if (typeof json?.message === 'string' && json.message.trim()) return new PushError(json.message.trim());
            return new PushError(`The archive app refused the ZIP (HTTP ${status}).`);
        }

        async function requestHealth(settings) {
            const { status, json } = await sendRequest({
                method: 'GET',
                url: endpointUrl(settings, '/health'),
                token: settings.token,
                timeout: HEALTH_TIMEOUT,
            });
            if (status !== 200 || !json) throw refusalError(status, json);
            return { max: Number(json.max) || 0, default: Number(json.default) || 0, library: json.library !== false };
        }

        // Once per page session: max only changes when Marco edits the app's settings, and a 413 corrects it.
        async function getHealth(settings) {
            health ??= await requestHealth(settings);
            return health;
        }

        function formatMiB(bytes) {
            return `${Math.ceil(bytes / 1048576)} MiB`;
        }

        /**
         * Resolves with { duplicate, message } once the app has imported the capture; rejects with the reason
         * to show otherwise. onProgress gets 0-95 per attempt and restarts at 0 on a refused attempt.
         */
        async function push(settings, blob, fileName, onProgress) {
            const { max } = await getHealth(settings);
            if (max && blob.size > max) {
                throw new PushError(
                    `This ZIP is too large for the archive app (${formatMiB(blob.size)}, limit ${formatMiB(max)}).`,
                );
            }
            for (let step = 0; step < BUDGET_STEPS.length; step++) {
                onProgress(0);
                const headers = {
                    'Content-Type': 'application/zip',
                    'X-Igexport-Filename': encodeURIComponent(fileName),
                };
                if (BUDGET_STEPS[step]) headers['X-Igexport-Budget'] = String(BUDGET_STEPS[step]);
                const { status, json } = await sendRequest({
                    method: 'POST',
                    url: endpointUrl(settings, '/ingest'),
                    token: settings.token,
                    headers,
                    body: blob,
                    timeout: INGEST_TIMEOUT,
                    onUploadProgress: (fraction) => onProgress(fraction * 95),
                });
                if (status >= 200 && status < 300) {
                    return { duplicate: json?.duplicate === true, message: String(json?.message ?? '').trim() };
                }
                if (status === 413 && json?.refusal === 'too-large') {
                    const appMax = Number(json.max) || 0;
                    if (appMax && health) health.max = appMax;
                    const next = BUDGET_STEPS[step + 1];
                    if (next && (!appMax || (next <= appMax && blob.size <= appMax))) continue;
                }
                throw refusalError(status, json);
            }
            throw new PushError('The archive app refused every budget.');
        }

        // A changed endpoint or token, from this tab or another, invalidates what /health said.
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && STORAGE_KEY in changes) health = null;
        });

        /* Settings: a sidebar item right after upstream's, opening our own dialog. */

        function describeTest(error, result) {
            if (error) return error.message;
            if (!result.library) return 'The archive app is running, but no library is open.';
            return `Connected. The archive app accepts ZIPs up to ${formatMiB(result.max)}.`;
        }

        function createSettingsModal() {
            const overlay = document.createElement('div');
            overlay.className = MODAL_CLASS;
            overlay.hidden = true;
            overlay.innerHTML = `
                <section class="igd-settings-dialog" dir="ltr" lang="en" role="dialog" aria-modal="true" aria-labelledby="igd-export-settings-title">
                    <header class="igd-settings-header">
                        <div>
                            <h2 id="igd-export-settings-title">Archive export</h2>
                            <p>Send exports straight to the instagram-archive app</p>
                        </div>
                        <button type="button" class="igd-settings-close" aria-label="Close settings">&times;</button>
                    </header>
                    <form class="igd-settings-content igd-export-settings-form">
                        <section class="igd-settings-section">
                            <h3>Archive app</h3>
                            <p class="igd-settings-help">Leave the token empty to download exports as files. A failed send always falls back to a download.</p>
                            <label class="igd-export-settings-field">
                                <span>Endpoint</span>
                                <input name="endpoint" type="url" spellcheck="false" autocomplete="off" placeholder="${DEFAULT_ENDPOINT}">
                            </label>
                            <label class="igd-export-settings-field">
                                <span>Token</span>
                                <span class="igd-export-settings-secret">
                                    <input name="token" type="password" spellcheck="false" autocomplete="off">
                                    <button type="button" class="igd-export-settings-reveal" hidden>Show</button>
                                </span>
                            </label>
                            <div class="igd-export-settings-actions">
                                <button type="submit" class="igd-export-settings-save">Save</button>
                                <button type="button" class="igd-export-settings-test">Test connection</button>
                            </div>
                            <p class="igd-settings-help igd-export-settings-status" role="status"></p>
                        </section>
                    </form>
                </section>`;

            const form = overlay.querySelector('form');
            const status = overlay.querySelector('.igd-export-settings-status');
            function closeModal() {
                overlay.hidden = true;
            }
            function formSettings() {
                return normalizeSettings({ endpoint: form.elements.endpoint.value, token: form.elements.token.value });
            }
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) closeModal();
            });
            overlay.querySelector('.igd-settings-close').addEventListener('click', closeModal);
            // Only a token being typed can be shown: the saved one stays masked.
            const reveal = overlay.querySelector('.igd-export-settings-reveal');
            form.elements.token.addEventListener('input', () => {
                reveal.hidden = false;
            });
            reveal.addEventListener('click', () => {
                const shown = form.elements.token.type === 'text';
                form.elements.token.type = shown ? 'password' : 'text';
                reveal.textContent = shown ? 'Show' : 'Hide';
            });
            // Instagram's and our own shortcuts must not see what is typed here.
            overlay.addEventListener('keydown', (event) => {
                event.stopPropagation();
                if (event.key === 'Escape') closeModal();
            });
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const settings = formSettings();
                await chrome.storage.local.set({ [STORAGE_KEY]: settings });
                closeModal();
            });
            overlay.querySelector('.igd-export-settings-test').addEventListener('click', async () => {
                const settings = formSettings();
                if (!settings.token) {
                    status.textContent = 'Enter the token shown in the archive app first.';
                    return;
                }
                status.textContent = 'Testing...';
                try {
                    status.textContent = describeTest(null, await requestHealth(settings));
                } catch (error) {
                    status.textContent = describeTest(error);
                }
            });
            document.body.appendChild(overlay);
            return overlay;
        }

        async function openSettingsModal() {
            const modal = document.querySelector(`.${MODAL_CLASS}`) ?? createSettingsModal();
            const settings = await readSettings();
            const form = modal.querySelector('form');
            form.elements.endpoint.value = settings.endpoint;
            form.elements.token.value = settings.token;
            form.elements.token.type = 'password';
            const reveal = modal.querySelector('.igd-export-settings-reveal');
            reveal.hidden = true;
            reveal.textContent = 'Show';
            modal.querySelector('.igd-export-settings-status').textContent = '';
            modal.hidden = false;
            form.elements.endpoint.focus();
        }

        function createSettingsNavItem() {
            const item = document.createElement('div');
            item.className = NAV_ITEM_CLASS;
            item.innerHTML = `
                <button type="button" class="igd-settings-nav-button" aria-label="Archive export settings" title="Archive export settings">
                    <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24">
                        <path d="M3 4h18v4H3zM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"></path>
                    </svg>
                    <span>Archive export</span>
                </button>`;
            item.querySelector('button').addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                openSettingsModal();
            });
            return item;
        }

        // Upstream already finds Instagram's sidebar: follow its item, as the export buttons follow its buttons.
        function syncSettingsNavItem() {
            const upstreamItem = document.querySelector(`.${UPSTREAM_NAV_ITEM_CLASS}`);
            const existing = document.querySelector(`.${NAV_ITEM_CLASS}`);
            if (!upstreamItem) {
                existing?.remove();
                return;
            }
            // existing first: when upstream's item is the last one, its nextElementSibling is null too.
            if (existing && upstreamItem.nextElementSibling === existing) return;
            existing?.remove();
            upstreamItem.insertAdjacentElement('afterend', createSettingsNavItem());
        }

        function queueUpdate() {
            if (updateQueued) return;
            updateQueued = true;
            requestAnimationFrame(() => {
                updateQueued = false;
                syncSettingsNavItem();
            });
        }

        const observer = new MutationObserver((records) => {
            if (records.some((record) => !record.target.closest?.(`.${NAV_ITEM_CLASS}, .${MODAL_CLASS}`))) {
                queueUpdate();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        navigation.addEventListener('navigate', queueUpdate);
        queueUpdate();

        return { getSettings, push };
    })(),
);
