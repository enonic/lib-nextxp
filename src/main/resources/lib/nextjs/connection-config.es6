const contentLib = require('/lib/xp/content');
const contextLib = require('/lib/xp/context');
export const removeEndSlashPattern = /\/+$/;
export const removeStartSlashPattern = /^\/+/;

function getSiteConfigInContext(pathOrId) {
    return contentLib.getSiteConfig({
        key: pathOrId || '/',
        applicationKey: app.name,
    });
}

export function getSiteConfig(pathOrId, repoId) {
    const context = contextLib.get();
    if (context.repository !== repoId) {
        try {
            return contextLib.run({
                principals: ["role:system.admin"],
                repository: repoId,
            }, function () {
                return getSiteConfigInContext(pathOrId);
            });
        } catch (e) {
            log.info('Error: ' + e.message);
        }
    } else {
        return getSiteConfigInContext(pathOrId);
    }
}

exports.getFrontendServerUrl = (config) => {
    // read site config first
    let url = config?.nextjsUrl;
    if (!url) {
        // fall back to config file
        url = app?.config?.nextjsUrl || "http://localhost:3000";
    }
    return url.replace(removeEndSlashPattern, '');
}

exports.getFrontendServerToken = (config) => {
    return config?.nextjsToken || app?.config?.nextjsToken;
}

// Header keys for communicating with frontend server
exports.FROM_XP_PARAM = '__fromxp__';

// TODO: These values must match XP_COMPONENT_TYPE TS-enum on the Next.js side
exports.FROM_XP_PARAM_VALUES = {
    TYPE: "type",
    PAGE: "page",
    COMPONENT: "component",
    LAYOUT: "layout",
    FRAGMENT: "fragment"
};
exports.COMPONENT_SUBPATH_HEADER = "Xp-Component-Path";
exports.XP_RENDER_MODE_HEADER = 'Content-Studio-Mode';

exports.XP_RENDER_MODE = {
    INLINE: "inline",
    EDIT: "edit",
    PREVIEW: "preview",
    LIVE: "live",
    ADMIN: "admin",
}
