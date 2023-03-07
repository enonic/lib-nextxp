import {getSite} from "./connection-config";

const eventLib = require('/lib/xp/event');
const httpClientLib = require('/lib/http-client');
const projectLib = require('/lib/xp/project');
const portalLib = require('/lib/xp/portal');
const nodeLib = require('/lib/xp/node');
const {getFrontendServerUrl, getFrontendServerToken} = require('./connection-config');

/*
* Use this function in your apps main.js file
* to initialize node events listener for all nextjs projects
* */
const REPOS = [];

export function subscribe() {
    REPOS.push(...queryNextjsRepos());

    subscribeToNodeEvents();
    subscribeToRepoEvents();
}

function queryNextjsRepos() {
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

    return sitesQueryResult.hits.map(site => site.repoId);
}

function refreshNextjsRepos() {
    // clear list of repos
    REPOS.length = 0;
    // load it with actual data
    REPOS.push(...queryNextjsRepos());

    log.debug(`Updated content event repos: [${REPOS}]`);
}

function subscribeToRepoEvents() {
    eventLib.listener({
        type: 'repository.*',
        localOnly: false,
        callback: function (event) {
            log.debug(`Got [${event.type}] event for: ${event.data?.id}`);
            refreshNextjsRepos();
        }
    });
    log.info(`Subscribed to repository update events...`);
}

function subscribeToNodeEvents() {
    eventLib.listener({
        type: 'node.*',
        localOnly: false,
        callback: function (event) {
            log.debug(`Got [${event.type}] event: ${JSON.stringify(event, null, 2)}`);

            let reposUpdated = false;
            for (let i = 0; i < event.data.nodes.length; i++) {
                const node = event.data.nodes[i];

                if (node.branch !== 'master' || !node.path.startsWith('/content/')) {
                    // continue to the next node until it's content from master
                    continue;
                }

                if (!reposUpdated) {
                    // update repos list in case a nextjs site was added to an existing repo
                    reposUpdated = true;
                    refreshNextjsRepos();
                }

                if (REPOS.indexOf(node.repo) >= 0) {
                    sendRevalidateAll(node.id, node.path, node.repo);
                    break;
                }
            }
        }
    });
    log.info(`Subscribed to content update events for repos: ${REPOS}`);
}

function sendRevalidateAll(nodeId, nodePath, repoId) {
    const site = getSite(nodeId, repoId);

    sendRevalidateRequest(null, site);
}

function sendRevalidateNode(nodeId, nodePath, repoId) {
    let contentPath = nodePath.replace(/\/content\/[^\s\/]+/, '');
    if (!contentPath || contentPath.trim().length === 0) {
        contentPath = '/';
    }

    const site = getSite(nodeId, repoId);

    sendRevalidateRequest(contentPath, site);
}

function sendRevalidateRequest(contentPath, site) {
    log.debug('Requesting revalidation of [' + contentPath || 'everything' + ']...');

    const response = httpClientLib.request({
        method: 'GET',
        url: getFrontendServerUrl(site) + '/_/enonic/cache/purge',
        // contentType: 'text/html',
        connectionTimeout: 5000,
        readTimeout: 5000,
        queryParams: {
            path: contentPath,
            token: getFrontendServerToken(site),
        },
        followRedirects: false,
    });
    if (response.status !== 200) {
        log.warning(`Revalidation of '${contentPath ?? 'everything'}' status: ${response.status}`);
    } else {
        log.debug(`Revalidation of [${contentPath ?? 'everything'}] done`);
    }
}