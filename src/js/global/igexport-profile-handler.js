/**
 * Profile export, page side (MAIN world), see SPECS.md "Profile export ZIP".
 *
 * The profile page already loaded the user record (with the full-size picture) to render its header:
 * find it in the React tree so the export makes no API request. Only an object whose username matches
 * is accepted, the tree also holds the viewer and suggested users.
 */
(() => {
    const MAX_DEPTH = 12;

    // Only read data properties, never call getters: some Instagram objects run code on property access.
    function readOwnValue(obj, key) {
        const descriptor = Object.getOwnPropertyDescriptor(obj, key);
        return descriptor && 'value' in descriptor ? descriptor.value : undefined;
    }

    function getOwnDataValues(obj) {
        return Object.values(Object.getOwnPropertyDescriptors(obj))
            .filter((descriptor) => 'value' in descriptor)
            .map((descriptor) => descriptor.value);
    }

    function findProfileUser(root, username) {
        const stack = [root];
        const visited = new Set();
        while (stack.length) {
            const current = stack.pop();
            if (visited.has(current)) continue;
            visited.add(current);
            // Root is the header element, other DOM nodes only lead to unrelated parts of the page.
            if (current !== root && current instanceof Node) continue;
            try {
                if (readOwnValue(current, 'username') === username) {
                    const picture = readOwnValue(current, 'hd_profile_pic_url_info');
                    if (picture && readOwnValue(picture, 'url')) return current;
                }
                for (const value of getOwnDataValues(current)) {
                    if (typeof value === 'object' && value !== null) stack.push(value);
                }
            } catch (error) {
                if (error.name === 'SecurityError') continue;
                console.log(error);
            }
        }
        return null;
    }

    /**
     * Copy of the record's own data properties, as JSON.stringify would see them, without invoking getters.
     * Functions and DOM nodes are left out; a cycle back to an ancestor is left out instead of recursing.
     */
    function toPlainData(value, ancestors = new Set(), depth = 0) {
        if (typeof value === 'function') return undefined;
        if (value === null || typeof value !== 'object') return value;
        if (value instanceof Node || ancestors.has(value) || depth > MAX_DEPTH) return undefined;
        ancestors.add(value);
        let result;
        if (Array.isArray(value)) {
            result = getOwnDataValues(value)
                .slice(0, value.length)
                .map((item) => toPlainData(item, ancestors, depth + 1) ?? null);
        } else {
            result = {};
            for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
                if (!('value' in descriptor)) continue;
                const plain = toPlainData(descriptor.value, ancestors, depth + 1);
                if (plain !== undefined) result[key] = plain;
            }
        }
        ancestors.delete(value);
        return result;
    }

    function hasStoreRefs(value) {
        return JSON.stringify(value).includes('"__ref"');
    }

    // Plain strings in both directions: objects do not cross between the page and the content script reliably.
    window.addEventListener('igexportProfileRequest', (event) => {
        const username = event.detail;
        const header = document.querySelector('main header') || document.querySelector('header');
        const record = header ? findProfileUser(header, username) : null;
        const user = record ? toPlainData(record) : null;
        window.dispatchEvent(
            new CustomEvent('igexportProfileResponse', {
                detail: JSON.stringify({ username, user, hasStoreRefs: user ? hasStoreRefs(user) : false }),
            }),
        );
    });
})();
