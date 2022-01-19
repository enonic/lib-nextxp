const removeEndSlashPattern = /\/+$/;

/** Return the value frontendServerUrl as configured in host app's site.xml, or fall back to default value "http://localhost:3000" */
exports.getFrontendServerUrl = () => {
    const config = app?.config || {};
    const url = config.nextjsUrl || "http://localhost:3000"
    return url.replace(removeEndSlashPattern, '');
}


// FIXME: This shouldn't be necessary to handle here, but until https://github.com/enonic/xp/issues/8530 is fixed, it is.
exports.MAPPING_TO_THIS_PROXY = '__nextjsproxy__';

// Detects if this proxy is used as a non-content-item proxy (and instead points to frontend assets etc), and matches any following path to regex group 1.
exports.PROXY_MATCH_PATTERN = new RegExp(`^/?${exports.MAPPING_TO_THIS_PROXY}(/.*)?$`);

// Header keys for communicating with frontend server
exports.FROM_XP_PARAM = '__fromxp__';

exports.CAN_NOT_RENDER_CODE = 418;

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
