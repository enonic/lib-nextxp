const contentLib = require('/lib/xp/content');
const contextLib = require('/lib/xp/context');
export const trailingSlashPattern = /\/*$/;

function getSiteInContext(pathOrId) {
    return contentLib.getSite({
        key: pathOrId || '/',
        applicationKey: app.name,
    });
}

const CONFIG_REGEXP = new RegExp('^nextjs\.([^.]+)\.(url|secret)$', 'i');
let CONFIGURATIONS;

function readConfigurations(force) {
    if (!force && CONFIGURATIONS) {
        return CONFIGURATIONS;
    }
    const appConfig = app?.config || {};
    CONFIGURATIONS = Object.keys(appConfig).reduce((all, key) => {
        if (!CONFIG_REGEXP.test(key)) {
            return all;
        }

        const result = CONFIG_REGEXP.exec(key);
        const name = result[1];
        const type = result[2];
        let configuration = all[name];
        if (!configuration) {
            configuration = {};
            all[name] = configuration;
        }
        configuration[type] = appConfig[key];

        return all;
    }, {});
    log.info('readConfigurations: ' + JSON.stringify(CONFIGURATIONS, null, 2));
    return CONFIGURATIONS;
}


function getNextjsConfig(name) {
    const configs = readConfigurations();
    let config = configs?.[name] || configs?.default;
    if (!config) {
        config = {
            url: 'http://127.0.0.1:3000',
            secret: 'mySecret',
        }
    }
    log.info('getNextjsConfig: ' + JSON.stringify(config, null, 2));
    return config;
}

export function listConfigurations() {
    const configs = readConfigurations();
    return Object.keys(configs).map(name => {
        return {...configs[name], name}
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

export function getFrontendServerUrl(site) {
    const name = getConfigFromSite(site)?.['nextjs-config'];
    return getNextjsConfig(name).url;
}

export function getFrontendServerToken(site) {
    const name = getConfigFromSite(site)?.['nextjs-config'];
    return getNextjsConfig(name).secret;
}

export function getProjectName(repoId) {
    let fullRepoName;
    if (repoId) {
        fullRepoName = repoId;
    } else {
        const context = contextLib.get();
        fullRepoName = context?.repository || 'com.enonic.cms.default';
    }
    return fullRepoName.replace('com.enonic.cms.', '');
}

function getConfigFromSite(site) {
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

exports.hashCode = function (str) {
    let hash = 0,
        i, chr;
    if (str.length === 0) return hash;
    for (i = 0; i < str.length; i++) {
        chr = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}

exports.XP_RENDER_MODE_HEADER = 'Content-Studio-Mode';

exports.XP_PROJECT_ID_HEADER = 'Content-Studio-Project';

export const XP_RENDER_MODE = {
    INLINE: "inline",
    EDIT: "edit",
    PREVIEW: "preview",
    LIVE: "live",
    ADMIN: "admin",
}
