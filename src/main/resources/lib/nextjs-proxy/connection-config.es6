const removeEndSlashPattern = /\/+$/;
export const removeStartSlashPattern = /^\/+/;

/** Return the value frontendServerUrl as configured in host app's site.xml, or fall back to default value "http://localhost:3000" */
exports.getFrontendServerUrl = () => {
    const config = app?.config || {};
    const url = config.nextjsUrl || "http://localhost:3000";
    return url.replace(removeEndSlashPattern, '');
}

exports.getFrontendServerToken = () => {
    return app?.config?.nextjsToken;
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
