const contentLib = require('/lib/xp/content');
const contextLib = require('/lib/xp/context');
export const trailingSlashPattern = /\/*$/;

function getSiteInContext(pathOrId) {
    return contentLib.getSite({
        key: pathOrId || '/',
        applicationKey: app.name,
    });
}

export function getSite(pathOrId, repoId) {
    const context = contextLib.get();
    if (context.repository !== repoId) {
        try {
            return contextLib.run({
                principals: ["role:system.admin"],
                repository: repoId,
            }, function () {
                return getSiteInContext(pathOrId);
            });
        } catch (e) {
            log.error('Failed to get site config: ' + e.message);
        }
    } else {
        return getSiteInContext(pathOrId);
    }
}

exports.getFrontendServerUrl = (site, repoId) => {
    const projectName = getProjectName(repoId);
    const siteName = site?._name;

    // check if the app is used to configure multiple sites
    let url = app?.config?.[`nextjs.${projectName}.${siteName}.url`];
    if (!url) {
        // fall back to the single app config
        url = app?.config?.['nextjs.url'];
    }
    if (!url) {
        // finally try reading the site config
        url = getConfigFromSite(site)?.nextjsUrl || "http://localhost:3000";
    }
    return url.replace(trailingSlashPattern, '');
}

exports.getFrontendServerToken = (site, repoId) => {
    const projectName = getProjectName(repoId);
    const siteName = site?._name;

    // check if the app is used to configure multiple sites
    let token = app?.config?.[`nextjs.${projectName}.${siteName}.secret`];
    if (!token) {
        // fall back to the single app config
        token = app?.config?.['nextjs.secret'];
    }
    if (!token) {
        // finally try reading the site config
        token = getConfigFromSite(site)?.nextjsToken;
    }
    return token;
}

const getProjectName = (repoId) => {
    let fullRepoName;
    if (repoId) {
        fullRepoName = repoId;
    } else {
        const context = contextLib.get();
        fullRepoName = context?.repository || 'com.enonic.cms.default';
    }
    return fullRepoName.replace('com.enonic.cms.', '');
}

exports.getProjectName = getProjectName;

const getConfigFromSite = (site) => {
    const siteConfigs = site?.data?.siteConfig;
    if (!siteConfigs?.length) {
        return;
    }

    for (let i = 0; i < siteConfigs.length; i++) {
        const datum = siteConfigs[i];
        if (datum.applicationKey === app.name) {
            return datum.config;
        }
    }
}

exports.XP_RENDER_MODE_HEADER = 'Content-Studio-Mode';

exports.XP_RENDER_MODE = {
    INLINE: "inline",
    EDIT: "edit",
    PREVIEW: "preview",
    LIVE: "live",
    ADMIN: "admin",
}
