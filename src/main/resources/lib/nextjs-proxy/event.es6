import {getSiteConfig} from "./connection-config";

const eventLib = require('/lib/xp/event');
const httpClientLib = require('/lib/http-client');
const projectLib = require('/lib/xp/project');
const nodeLib = require('/lib/xp/node');
const {getFrontendServerUrl, getFrontendServerToken} = require('./connection-config');

/*
* Use this function in your apps main.js file
* to initialize node events listener for all nextjs projects
* */
export function subscribe() {
    const sources = projectLib.list().map(repo => ({
        repoId: `com.enonic.cms.${repo.id}`,
        branch: "master",
        principals: ["role:system.admin"],
    }));

    const sitesQueryResult = nodeLib.multiRepoConnect({sources}).query({
        start: 0,
        count: 999,
        query: "type = 'portal:site'",
        filters: {
            exists: {
                field: "data.siteConfig.config.nextjsToken",
            }
        }
    });

    log.debug('Query nextjs sites to listen: ' + JSON.stringify(sitesQueryResult, null, 2));

    if (sitesQueryResult.hits) {
        subscribeToNodeEvents(sitesQueryResult.hits.map((site) => (site.repoId)))
    }
}

function subscribeToNodeEvents(repos) {
    log.info(`Subscribing to content update events for repos [${repos}]...`);

    eventLib.listener({
        type: 'node.*',
        localOnly: false,
        callback: function (event) {
            for (let i = 0; i < event.data.nodes.length; i++) {

                const node = event.data.nodes[i];
                if (node.path.startsWith('/content/') && repos.indexOf(node.repo) >= 0) {
                    log.info(`Got [${event.type}] event for: ${node.path}`);
                    postRevalidateRequest(node.id, node.path, node.repo);    // remove the /content/<site>
                }
            }
        }
    });
}

function postRevalidateRequest(nodeId, nodePath, repoId) {
    let siteRelativePath = nodePath.replace(/\/content\/[^\s\/]+/, '');
    if (!siteRelativePath || siteRelativePath.trim().length === 0) {
        siteRelativePath = '/';
    }

    const config = getSiteConfig(nodeId, repoId)

    log.debug('Requesting revalidation of [' + siteRelativePath + ']...');
    const response = httpClientLib.request({
        method: 'GET',
        url: getFrontendServerUrl(config) + '/api/revalidate',
        // contentType: 'text/html',
        connectionTimeout: 5000,
        readTimeout: 5000,
        queryParams: {
            path: siteRelativePath,
            token: getFrontendServerToken(config),
        },
        followRedirects: false,
    });
    if (response.status !== 200) {
        log.warning(`Revalidation of '${siteRelativePath}' status: ${response.status}`);
    } else {
        log.debug(`Revalidation of [${siteRelativePath}] done`);
    }
}