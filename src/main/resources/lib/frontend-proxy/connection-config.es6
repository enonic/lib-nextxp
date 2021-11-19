const portalLib = require('/lib/xp/portal');

const removeEndSlashPattern = /\/+$/;

/** Return the value frontendServerUrl as configured in host app's site.xml, or fall back to default value "http://localhost:3000" */
exports.getFrontendServerUrl = () => {
    const frontendServerUrl = (portalLib.getSiteConfig().frontendServerUrl) || "http://localhost:3000";
    return frontendServerUrl.replace(removeEndSlashPattern, '');
}


// FIXME: This shouldn't be necessary to handle here, but until https://github.com/enonic/xp/issues/8530 is fixed, it is.
exports.MAPPING_TO_THIS_PROXY = '__frontendproxy__';

// Detects if this proxy is used as a non-content-item proxy (and instead points to frontend assets etc), and matches any following path to regex group 1.
exports.PROXY_MATCH_PATTERN = new RegExp(`^/?${exports.MAPPING_TO_THIS_PROXY}(/.*)?$`);

exports.FROM_XP_PARAM = '__fromxp__';
