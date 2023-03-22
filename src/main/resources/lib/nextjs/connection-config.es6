const contentLib = require('/lib/xp/content');
const contextLib = require('/lib/xp/context');
export const trailingSlashPattern = /\/*$/;

const APP_NEXTJS_NAME = 'com.enonic.app.nextjs';

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

exports.getFrontendServerUrl = (site) => {
    const projectName = getProjectName();
    const siteName = site?._name;
    let url;
    if (app.name === APP_NEXTJS_NAME) {
        // check the app-nextjs config for project and site
        url = app?.config?.[`settings.${projectName}.${siteName}.url`];
    }
    if (!url) {
        // fall back to third-party app using lib-nextjs config file
        url = app?.config?.['nextjs.url'];
    }
    if (!url) {
        // read site config next
        url = getConfigFromSite(site)?.nextjsUrl || "http://localhost:3000";
    }
    return url.replace(trailingSlashPattern, '');
}

exports.getFrontendServerToken = (site) => {
    const projectName = getProjectName();
    const siteName = site?._name;

    let token;
    if (app.name === APP_NEXTJS_NAME) {
        // check the app-nextjs config for project and site
        token = app?.config?.[`settings.${projectName}.${siteName}.secret`];
    }
    if (!token) {
        // fall back to third-party app using lib-nextjs config file
        token = app?.config?.['nextjs.secret'];
    }
    if (!token) {
        // read site config last
        token = getConfigFromSite(site)?.nextjsToken;
    }
    return token;
}

const getProjectName = () => {
    const context = contextLib.get();
    let project = 'default';
    if (context?.repository) {
        project = context.repository.replace('com.enonic.cms.', '');
    }
    return project;
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
