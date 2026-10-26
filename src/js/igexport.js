/**
 * Post and story export ZIP for the instagram-archive importer, see SPECS.md.
 *
 * Self-contained on purpose: it attaches next to upstream's inline download buttons
 * and reuses upstream's queries, media download and filename settings,
 * so syncing with upstream does not touch this file.
 */
(() => {
    const BUTTON_CLASS = 'igd-post-inline-export';
    const REEL_BUTTON_CLASS = 'igd-post-inline-export-reel';
    const STORY_BUTTON_CLASS = 'igd-story-inline-export';
    const FAILED_CLASS = 'igd-inline-export-failed';
    const UPSTREAM_BUTTON_CLASS = 'igd-post-inline-download';
    const UPSTREAM_REEL_BUTTON_CLASS = 'igd-post-inline-download-reel';
    const UPSTREAM_STORY_BUTTON_CLASS = 'igd-story-inline-download';
    const OWN_BUTTONS = `.${BUTTON_CLASS}, .${STORY_BUTTON_CLASS}`;
    const BUTTON_LABEL = 'Export post as ZIP';
    const STORY_BUTTON_LABEL = 'Export story as ZIP';

    // Contract with the importer, bump on any incompatible change. Never reuse a number.
    const IGEXPORT_FORMAT_VERSION = 2;
    // Extensionless entries are reserved for the export, they must not contain a dot.
    const MARKER_ENTRY = 'igexport';
    const KIND_ENTRY = 'igexport-kind';
    const PROVENANCE_ENTRY = 'igexport-provenance';
    const USER_ENTRY = 'igexport-user';
    const EXPORT_KINDS = Object.freeze({ POST: 'post', STORY: 'story' });
    const POST_OBJECT_SOURCE = 'PolarisPostRootQuery';
    const STORY_OBJECT_SOURCE = 'PolarisStoriesV3ReelPageGalleryQuery';
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
     * Same shape as downloadStoryPhotos() in story.js, for the one story item on screen.
     * The item itself is the container, so #id names the archive after the story, not after the reel
     * (upstream uses the reel id, the same for every story of an account).
     */
    function getStoryExportData(item, reelUser) {
        const media = extractMediaData(item);
        if (!media) throw new Error('the story has no downloadable media');
        return {
            type: DOWNLOAD_FILENAME_SCOPES.STORIES,
            id: String(item.pk),
            date: item['taken_at'],
            title: '',
            user: {
                username: item.user?.username ?? reelUser?.username ?? '',
            },
            media: [media],
        };
    }

    /**
     * The importer pairs media to slides by the item id in the name. Names come from upstream's settings,
     * so the id is missing when the template lacks #id or the 180-character limit cut it off
     * (e.g. a long #title before #id). Fail with the cause instead of saving a ZIP the importer refuses.
     */
    function assertMediaNameHasId(fileName, item, scope) {
        const id = String(item.id ?? '');
        if (id && fileName.includes(id)) return;
        const template = scope === DOWNLOAD_FILENAME_SCOPES.STORIES ? 'Stories' : 'Posts';
        throw new Error(
            `media name "${fileName}" lacks item id ${id}: add #id to the ${template} file name template, ` +
                'or move it before #title (names are cut at 180 characters)',
        );
    }

    function getProvenance(exportedAt, source) {
        const manifest = chrome.runtime.getManifest();
        return {
            exported_at: exportedAt.toISOString(),
            extension_version: manifest.version_name ?? manifest.version,
            upstream_version: manifest.version,
            source,
        };
    }

    /**
     * Optional entry: the importer accepts a ZIP without it, so a failed download only skips it.
     * Full size only, never profile_pic_url: it is a 150x150 thumbnail.
     */
    async function fetchProfilePicture(user) {
        const url = user?.hd_profile_pic_url_info?.url;
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

    /**
     * Builds the ZIP shared by every kind, see SPECS.md for the layout.
     * rawObject is saved unmodified as the .json entry, extraEntries go in as they are.
     */
    async function createExportZip(
        { kind, source, exportedAt, data, rawObject, caption, profileUser, extraEntries = [] },
        onProgress,
    ) {
        const archiveName = getArchiveFileName(data);
        const baseName = archiveName.replace(/\.zip$/, '');
        const usedNames = new Set([MARKER_ENTRY, KIND_ENTRY, PROVENANCE_ENTRY, USER_ENTRY]);
        const files = [
            { title: MARKER_ENTRY, data: new Blob([String(IGEXPORT_FORMAT_VERSION)], { type: 'text/plain' }) },
            { title: KIND_ENTRY, data: new Blob([kind], { type: 'text/plain' }) },
            { title: PROVENANCE_ENTRY, data: jsonBlob(getProvenance(exportedAt, source)) },
            ...extraEntries,
        ];

        // Check names before downloading anything; checked again below, the final name can depend on the blob.
        data.media.forEach((item) => assertMediaNameHasId(getMediaFileName(data, item, null), item, data.type));

        let processed = 0;
        for (const item of data.media) {
            const blob = await fetchBestMediaBlob(item, ({ percent }) => {
                onProgress(((processed + percent / 100) / data.media.length) * 90);
            });
            const fileName = getMediaFileName(data, item, blob);
            assertMediaNameHasId(fileName, item, data.type);
            files.push({ title: getUniqueArchiveEntryName(fileName, usedNames), data: blob });
            processed++;
            onProgress((processed / data.media.length) * 90);
        }

        files.push({ title: getUniqueArchiveEntryName(`${baseName}.txt`, usedNames), data: textBlob(caption) });
        files.push({ title: getUniqueArchiveEntryName(`${baseName}.json`, usedNames), data: jsonBlob(rawObject) });

        const profilePicture = await fetchProfilePicture(profileUser);
        // The importer finds the picture by its .profile.<ext> suffix before matching slide ids (a single-media
        // post's picture also carries the post pk), so it is never renamed on a collision: skipped instead.
        const profileName = profilePicture && `${baseName}.profile.${profilePicture.format}`;
        if (profileName && !usedNames.has(profileName.toLowerCase())) {
            usedNames.add(profileName.toLowerCase());
            files.push({ title: profileName, data: profilePicture.blob });
        }
        onProgress(95);

        const zip = await createZip(files);
        return { blob: setArchiveComment(zip, `igexport v${IGEXPORT_FORMAT_VERSION}`), fileName: archiveName };
    }

    async function createPostExport(shortcode, onProgress) {
        const json = await getPostPhotos(shortcode);
        if (!json) throw new Error('post not found');
        // The moment the post object was captured, used by the importer to order captures of one post.
        const exportedAt = new Date();
        return createExportZip(
            {
                kind: EXPORT_KINDS.POST,
                source: POST_OBJECT_SOURCE,
                exportedAt,
                data: getPostExportData(json, shortcode),
                rawObject: json,
                caption: json.caption?.text?.trim() ?? '',
                profileUser: json.user,
            },
            onProgress,
        );
    }

    // /stories/<username>/<storyId>/, highlights are not exported yet.
    function getCurrentStoryFromPath() {
        const [prefix, username, storyId] = window.location.pathname.split('/').filter(Boolean);
        if (prefix !== 'stories' || !username || username === 'highlights') return null;
        return { username, storyId: /^\d+$/.test(storyId ?? '') ? storyId : '' };
    }

    // Same criteria as upstream's story button: the largest visible image or video is the story on screen.
    function readVisibleStoryMedia() {
        const media = [...document.querySelectorAll('img, video')]
            .map((element) => ({ element, rect: element.getBoundingClientRect() }))
            .filter(
                ({ rect }) =>
                    rect.width >= 240 &&
                    rect.height >= 300 &&
                    rect.bottom > 0 &&
                    rect.right > 0 &&
                    rect.top < window.innerHeight &&
                    rect.left < window.innerWidth,
            )
            .sort((first, second) => second.rect.width * second.rect.height - first.rect.width * first.rect.height)[0]
            ?.element;
        return {
            sourceUrl: media?.currentSrc || media?.src || '',
            posterUrl: media instanceof HTMLVideoElement ? media.poster || '' : '',
        };
    }

    // Instagram can update the visible media across render frames: wait until two consecutive reads agree.
    async function readStableVisibleStoryMedia() {
        let previous = readVisibleStoryMedia();
        for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const current = readVisibleStoryMedia();
            if (current.sourceUrl === previous.sourceUrl && current.posterUrl === previous.posterUrl) return current;
            previous = current;
        }
        return null;
    }

    /**
     * The first story of a reel has no id in the URL (/stories/<username>/).
     * Match the media on screen against the items with upstream's findMediaByRenderedUrl()
     * (cache key id, then URL path). No index or position fallback: no match fails the export.
     */
    function findItemByVisibleMedia(items, visible) {
        const media = items
            .map((item) => {
                const mediaData = extractMediaData(item);
                return mediaData && { ...mediaData, item };
            })
            .filter(Boolean);
        const data = { media };
        return (findMediaByRenderedUrl(data, visible.sourceUrl) ?? findMediaByRenderedUrl(data, visible.posterUrl))
            ?.item;
    }

    async function createStoryExport(onProgress) {
        const story = getCurrentStoryFromPath();
        if (!story) throw new Error('not on a story page');
        // Read what is on screen before any request: the story keeps playing and can advance meanwhile.
        const visible = story.storyId ? null : await readStableVisibleStoryMedia();
        if (!story.storyId && !visible?.sourceUrl && !visible?.posterUrl) {
            throw new Error('cannot identify the story on screen');
        }
        const userId = await getUserIdFromSearch(story.username);
        if (!userId) throw new Error(`user ${story.username} not found`);
        const reel = await getStoryPhotos(userId);
        if (!reel?.items?.length) throw new Error('no stories found');
        const exportedAt = new Date();
        const item = story.storyId
            ? reel.items.find((candidate) => getMediaId(candidate.pk ?? candidate.id) === story.storyId)
            : findItemByVisibleMedia(reel.items, visible);
        if (!item) {
            throw new Error(
                story.storyId
                    ? `story ${story.storyId} is not in the current stories`
                    : 'cannot match the story on screen to the current stories',
            );
        }
        // Story items carry a stub user (pk, no username, no picture): the reel's user is added
        // only when the item lacks the username the importer needs, one source per fact otherwise.
        const extraEntries = item.user?.username ? [] : [{ title: USER_ENTRY, data: jsonBlob(reel.user ?? {}) }];
        return createExportZip(
            {
                kind: EXPORT_KINDS.STORY,
                source: STORY_OBJECT_SOURCE,
                exportedAt,
                data: getStoryExportData(item, reel.user),
                rawObject: item,
                caption: item.caption?.text?.trim() ?? '',
                // No profile picture: story users only carry the thumbnail, and the full-size one
                // would need a heavily rate-limited user info request.
                profileUser: null,
                extraEntries,
            },
            onProgress,
        );
    }

    function showFailedState(button, error, label) {
        button.classList.add(FAILED_CLASS);
        button.title = `Export failed: ${error.message || error}`;
        setTimeout(() => {
            button.classList.remove(FAILED_CLASS);
            button.title = label;
        }, FAILED_STATE_DURATION);
    }

    async function runExport(button, label, createExport) {
        if (button.disabled) return;
        button.classList.remove(FAILED_CLASS);
        button.title = label;
        setInlineDownloadProgress(button, 0);
        try {
            const { blob, fileName } = await createExport((percent) => setInlineDownloadProgress(button, percent));
            setInlineDownloadProgress(button, 100);
            saveFile(blob, fileName);
        } catch (error) {
            console.log(error);
            showFailedState(button, error, label);
        } finally {
            setTimeout(() => resetInlineDownloadProgress(button), 300);
        }
    }

    function createExportButton({ className, label, iconSize, onClick }) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.title = label;
        button.setAttribute('aria-label', label);
        // No aria-label on the svg: upstream counts labelled icons to find the action bar and story toolbar.
        button.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" width="${iconSize}" height="${iconSize}">
                <path d="M3 4h18v4H3zM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
            </svg>`;
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            onClick(button);
        });
        return button;
    }

    function createPostExportButton(shortcode) {
        const button = createExportButton({
            className: BUTTON_CLASS,
            label: BUTTON_LABEL,
            iconSize: 24,
            onClick: (target) =>
                runExport(target, BUTTON_LABEL, (onProgress) =>
                    createPostExport(target.dataset.postShortcode, onProgress),
                ),
        });
        button.dataset.postShortcode = shortcode;
        return button;
    }

    function createStoryExportButton() {
        return createExportButton({
            className: STORY_BUTTON_CLASS,
            label: STORY_BUTTON_LABEL,
            iconSize: 20,
            onClick: (target) => runExport(target, STORY_BUTTON_LABEL, createStoryExport),
        });
    }

    /**
     * Upstream already solves finding each post's action bar (feed, post page, reels, translated labels)
     * and the story toolbar, so follow its inline download buttons and keep ours right after them.
     */
    function syncExportButtons() {
        const activeButtons = new Set();
        for (const upstreamButton of document.querySelectorAll(`.${UPSTREAM_BUTTON_CLASS}`)) {
            const shortcode = upstreamButton.dataset.postShortcode;
            if (!shortcode) continue;
            let button = upstreamButton.nextElementSibling;
            if (!button?.classList.contains(BUTTON_CLASS) || button.dataset.postShortcode !== shortcode) {
                if (button?.classList.contains(BUTTON_CLASS)) button.remove();
                button = createPostExportButton(shortcode);
                upstreamButton.insertAdjacentElement('afterend', button);
            }
            button.classList.toggle(REEL_BUTTON_CLASS, upstreamButton.classList.contains(UPSTREAM_REEL_BUTTON_CLASS));
            activeButtons.add(button);
        }

        const upstreamStoryButton = document.querySelector(`.${UPSTREAM_STORY_BUTTON_CLASS}`);
        if (upstreamStoryButton && getCurrentStoryFromPath()) {
            let button = upstreamStoryButton.nextElementSibling;
            if (!button?.classList.contains(STORY_BUTTON_CLASS)) {
                button = createStoryExportButton();
                upstreamStoryButton.insertAdjacentElement('afterend', button);
            }
            activeButtons.add(button);
        }

        document.querySelectorAll(OWN_BUTTONS).forEach((button) => {
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
        if (records.some((record) => !record.target.closest?.(OWN_BUTTONS))) queueUpdate();
    });
    function observePage() {
        observer.observe(document.body, { childList: true, subtree: true });
    }
    observePage();
    // Story URLs change from one story to the next without always touching the DOM we observe.
    navigation.addEventListener('navigate', queueUpdate);
    queueUpdate();
})();
