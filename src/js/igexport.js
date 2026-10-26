/**
 * Post export ZIP for the instagram-archive importer, see SPECS.md.
 *
 * Self-contained on purpose: it attaches next to upstream's inline post download button
 * and reuses upstream's post query, media download and filename settings,
 * so syncing with upstream does not touch this file.
 */
(() => {
    const BUTTON_CLASS = 'igd-post-inline-export';
    const REEL_BUTTON_CLASS = 'igd-post-inline-export-reel';
    const FAILED_CLASS = 'igd-post-inline-export-failed';
    const UPSTREAM_BUTTON_CLASS = 'igd-post-inline-download';
    const UPSTREAM_REEL_BUTTON_CLASS = 'igd-post-inline-download-reel';
    const BUTTON_LABEL = 'Export post as ZIP';

    // Contract with the importer, bump on any incompatible change. Never reuse a number.
    const IGEXPORT_FORMAT_VERSION = 2;
    // Extensionless entries are reserved for the export, they must not contain a dot.
    const MARKER_ENTRY = 'igexport';
    const PROVENANCE_ENTRY = 'igexport-provenance';
    const POST_OBJECT_SOURCE = 'PolarisPostRootQuery';
    const FAILED_STATE_DURATION = 3000;
    let updateQueued = false;

    function jsonBlob(value) {
        return new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
    }

    function textBlob(value) {
        return new Blob([value], { type: 'text/plain;charset=utf-8' });
    }

    /**
     * Same shape as downloadPostPhotos() in post.js, built from the post object we already have
     * so the export makes a single post request and keeps the raw object for the .json entry.
     * Unlike upstream, a slide without downloadable media fails the export instead of being dropped:
     * the importer pairs media entries 1:1 with the slides.
     */
    function getPostExportData(json, shortcode) {
        const slides = json['carousel_media'] ?? [json];
        const media = slides.map(extractMediaData);
        if (media.some((item) => !item)) throw new Error('a slide has no downloadable media');
        return {
            type: DOWNLOAD_FILENAME_SCOPES.POST,
            id: String(json.pk ?? convertToPostId(shortcode)),
            date: json['taken_at'],
            title: json.caption?.text?.split('\n')[0] || '',
            user: {
                username: json.user['username'],
            },
            media,
        };
    }

    /**
     * The importer pairs media to slides by the item id in the name. Names come from upstream's settings,
     * so the id is missing when the post template lacks #id or the 180-character limit cut it off
     * (e.g. a long #title before #id). Fail with the cause instead of saving a ZIP the importer refuses.
     */
    function assertMediaNameHasId(fileName, item) {
        const id = String(item.id ?? '');
        if (id && fileName.includes(id)) return;
        throw new Error(
            `media name "${fileName}" lacks item id ${id}: add #id to the Posts file name template, ` +
                'or move it before #title (names are cut at 180 characters)',
        );
    }

    function getProvenance(exportedAt) {
        const manifest = chrome.runtime.getManifest();
        return {
            exported_at: exportedAt.toISOString(),
            extension_version: manifest.version_name ?? manifest.version,
            upstream_version: manifest.version,
            source: POST_OBJECT_SOURCE,
        };
    }

    // Optional entry: the importer accepts a ZIP without it, so a failed download only skips it.
    async function fetchProfilePicture(user) {
        const url = user?.hd_profile_pic_url_info?.url || user?.profile_pic_url;
        if (!url) return null;
        try {
            const blob = await fetchProgressiveMediaBlob(url);
            const format = resolveMediaFormatFromContentType(blob.type) || resolveMediaFormat(url) || 'jpg';
            return { blob, format };
        } catch (error) {
            console.log(error);
            return null;
        }
    }

    // createZip() always ends with an empty archive comment: replace its 2-byte length with ours.
    function setArchiveComment(zip, comment) {
        const bytes = new TextEncoder().encode(comment);
        const length = new Uint8Array(new Uint16Array([bytes.length]).buffer);
        return new Blob([zip.slice(0, zip.size - 2), length, bytes], { type: 'application/zip' });
    }

    async function createPostExport(shortcode, onProgress) {
        const json = await getPostPhotos(shortcode);
        if (!json) throw new Error('post not found');
        // The moment the post object was captured, used by the importer to order captures of one post.
        const exportedAt = new Date();
        const data = getPostExportData(json, shortcode);
        const archiveName = getArchiveFileName(data);
        const baseName = archiveName.replace(/\.zip$/, '');
        const usedNames = new Set([MARKER_ENTRY, PROVENANCE_ENTRY]);
        const files = [
            { title: MARKER_ENTRY, data: new Blob([String(IGEXPORT_FORMAT_VERSION)], { type: 'text/plain' }) },
            { title: PROVENANCE_ENTRY, data: jsonBlob(getProvenance(exportedAt)) },
        ];

        // Check names before downloading anything; checked again below, the final name can depend on the blob.
        data.media.forEach((item) => assertMediaNameHasId(getMediaFileName(data, item, null), item));

        let processed = 0;
        for (const item of data.media) {
            const blob = await fetchBestMediaBlob(item, ({ percent }) => {
                onProgress(((processed + percent / 100) / data.media.length) * 90);
            });
            const fileName = getMediaFileName(data, item, blob);
            assertMediaNameHasId(fileName, item);
            files.push({ title: getUniqueArchiveEntryName(fileName, usedNames), data: blob });
            processed++;
            onProgress((processed / data.media.length) * 90);
        }

        files.push({
            title: getUniqueArchiveEntryName(`${baseName}.txt`, usedNames),
            data: textBlob(json.caption?.text?.trim() ?? ''),
        });
        files.push({ title: getUniqueArchiveEntryName(`${baseName}.json`, usedNames), data: jsonBlob(json) });

        const profilePicture = await fetchProfilePicture(json.user);
        if (profilePicture) {
            files.push({
                title: getUniqueArchiveEntryName(`${baseName}.profile.${profilePicture.format}`, usedNames),
                data: profilePicture.blob,
            });
        }
        onProgress(95);

        const zip = await createZip(files);
        return { blob: setArchiveComment(zip, `igexport v${IGEXPORT_FORMAT_VERSION}`), fileName: archiveName };
    }

    function showFailedState(button, error) {
        button.classList.add(FAILED_CLASS);
        button.title = `Export failed: ${error.message || error}`;
        setTimeout(() => {
            button.classList.remove(FAILED_CLASS);
            button.title = BUTTON_LABEL;
        }, FAILED_STATE_DURATION);
    }

    async function exportPost(button) {
        if (button.disabled) return;
        button.classList.remove(FAILED_CLASS);
        button.title = BUTTON_LABEL;
        setInlineDownloadProgress(button, 0);
        try {
            const { blob, fileName } = await createPostExport(button.dataset.postShortcode, (percent) =>
                setInlineDownloadProgress(button, percent),
            );
            setInlineDownloadProgress(button, 100);
            saveFile(blob, fileName);
        } catch (error) {
            console.log(error);
            showFailedState(button, error);
        } finally {
            setTimeout(() => resetInlineDownloadProgress(button), 300);
        }
    }

    function createExportButton(shortcode) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = BUTTON_CLASS;
        button.dataset.postShortcode = shortcode;
        button.title = BUTTON_LABEL;
        button.setAttribute('aria-label', BUTTON_LABEL);
        // No aria-label on the svg: upstream counts labelled icons to find the post action bar.
        button.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24">
                <path d="M3 4h18v4H3zM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
            </svg>`;
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            exportPost(button);
        });
        return button;
    }

    /**
     * Upstream already solves finding each post's action bar (feed, post page, reels, translated labels),
     * so follow its inline download button and keep ours right after it.
     */
    function syncExportButtons() {
        const activeButtons = new Set();
        for (const upstreamButton of document.querySelectorAll(`.${UPSTREAM_BUTTON_CLASS}`)) {
            const shortcode = upstreamButton.dataset.postShortcode;
            if (!shortcode) continue;
            let button = upstreamButton.nextElementSibling;
            if (!button?.classList.contains(BUTTON_CLASS) || button.dataset.postShortcode !== shortcode) {
                if (button?.classList.contains(BUTTON_CLASS)) button.remove();
                button = createExportButton(shortcode);
                upstreamButton.insertAdjacentElement('afterend', button);
            }
            button.classList.toggle(REEL_BUTTON_CLASS, upstreamButton.classList.contains(UPSTREAM_REEL_BUTTON_CLASS));
            activeButtons.add(button);
        }
        document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => {
            if (!activeButtons.has(button)) button.remove();
        });
    }

    function queueUpdate() {
        if (updateQueued) return;
        updateQueued = true;
        requestAnimationFrame(() => {
            updateQueued = false;
            // Our insertions must not schedule another pass.
            observer.disconnect();
            try {
                syncExportButtons();
            } finally {
                observePage();
            }
        });
    }

    const observer = new MutationObserver((records) => {
        if (records.some((record) => !record.target.closest?.(`.${BUTTON_CLASS}`))) queueUpdate();
    });
    function observePage() {
        observer.observe(document.body, { childList: true, subtree: true });
    }
    observePage();
    queueUpdate();
})();
