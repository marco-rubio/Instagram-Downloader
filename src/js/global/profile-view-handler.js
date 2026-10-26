/**
 * Profile page already load user info (include hd profile picture) to render header.
 * Find it in ReactFiber so content script don't need to call rate limited api.
 * Only accept object with matching username, the tree also contain viewer and suggested users.
 */
(() => {
    /**
     * Only read data properties, never call getters.
     * Some Instagram objects run code on property access (lazy query, story viewer, ...),
     * reading them through Object.values() caused stories to open.
     */
    function readOwnValue(obj, key) {
        const descriptor = Object.getOwnPropertyDescriptor(obj, key);
        return descriptor && 'value' in descriptor ? descriptor.value : undefined;
    }
    function getOwnDataValues(obj) {
        return Object.values(Object.getOwnPropertyDescriptors(obj))
            .filter(descriptor => 'value' in descriptor)
            .map(descriptor => descriptor.value);
    }
    function findProfileUser(root, username) {
        const stack = [root];
        const visited = new Set();
        let fallback = null;
        while (stack.length) {
            const current = stack.pop();
            if (visited.has(current)) continue;
            visited.add(current);
            // Root is the header element, other DOM nodes only lead to unrelated part of the page
            if (current !== root && current instanceof Node) continue;
            try {
                if (readOwnValue(current, 'username') === username) {
                    const hdPicture = readOwnValue(current, 'hd_profile_pic_url_info');
                    if (hdPicture && readOwnValue(hdPicture, 'url')) return current;
                    if (!fallback && (readOwnValue(current, 'pk') || readOwnValue(current, 'id'))) fallback = current;
                }
                for (const value of getOwnDataValues(current)) {
                    if (typeof value === 'object' && value !== null) {
                        stack.push(value);
                    }
                }
            } catch (error) {
                if (error.name === 'SecurityError') continue;
                console.log(error);
            }
        }
        return fallback;
    }
    window.addEventListener('profileInfoRequest', e => {
        const username = e.detail;
        const header = document.querySelector('main header') || document.querySelector('header');
        const user = header ? findProfileUser(header, username) : null;
        const hdPicture = user ? readOwnValue(user, 'hd_profile_pic_url_info') : null;
        window.dispatchEvent(new CustomEvent('profileInfoResponse', {
            detail: {
                username: username,
                id: user ? String(readOwnValue(user, 'pk') || readOwnValue(user, 'id') || '') : '',
                url: (hdPicture && readOwnValue(hdPicture, 'url')) || ''
            }
        }));
    });
})();
