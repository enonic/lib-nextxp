import {getProjectName, getSite, XP_PROJECT_ID_HEADER} from "./config";

const eventLib = require('/lib/xp/event');
const httpClientLib = require('/lib/http-client');
const projectLib = require('/lib/xp/project');
const contextLib = require('/lib/xp/context');
const nodeLib = require('/lib/xp/node');

const {getFrontendServerUrl, getFrontendServerToken} = require('./config');

const debouncer = __.newBean('com.enonic.lib.nextxp.debounce.DebounceExecutor');

/*
* Use this function in your apps main.js file
* to initialize node events listener for all nextjs projects
* */
const REPOS = [];

const OLD_PATHS_CACHE = [];

export function subscribe() {
    REPOS.push(...queryNextjsRepos());

    subscribeToNodeEvents();
    subscribeToRepoEvents();
}

function queryNextjsRepos() {
    const currentContext = contextLib.get();
    if (currentContext.authInfo.principals.indexOf('role:system.admin') < 0) {
        try {
            return contextLib.run({
                principals: ["role:system.admin"]
            }, function () {
                return queryNextjsReposInContext();
            });
        } catch (e) {
            log.error('Failed to query nextjs repos: ' + e.message);
        }
    } else {
        return queryNextjsReposInContext();
    }
}

function queryNextjsReposInContext() {
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
            hasValue: {
                "field": "data.siteConfig.applicationKey",
                "values": [
                    app.name,
                ]
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
                const isMaster = node.branch === 'master';
                const isMove = isMoveEvent(event);

                if (!node.path.startsWith('/content/') || !isMaster && !isMove) {
                    // continue to the next node until it's content related event from master or move event from draft
                    continue;
                }

                if (isMaster && !reposUpdated) {
                    // update repos list in case a nextjs site was added to an existing repo
                    reposUpdated = true;
                    refreshNextjsRepos();
                }

                if (REPOS.indexOf(node.repo) >= 0) {
                    if (isMove) {
                        OLD_PATHS_CACHE.push({
                            id: node.id,
                            path: node.path,
                            repo: node.repo,
                        })
                    }
                    if (isMaster) {
                        sendRevalidateAll(node.id, node.path, node.repo);
                        // also invalidate old paths
                        OLD_PATHS_CACHE.forEach(val => sendRevalidateNode(val.id, val.path, val.repo))
                        OLD_PATHS_CACHE.length = 0;
                        break;
                    }
                }
            }
        }
    });
    log.info(`Subscribed to content update events for repos: ${REPOS}`);
}

function isMoveEvent(event) {
    return event.type === 'node.moved' || event.type === 'node.renamed'
}

function sendRevalidateAll(nodeId, nodePath, repoId) {
    const site = getSite(nodeId, repoId);

    debouncer.debounce(() => sendRevalidateRequest(null, site, repoId), 500)
}

function sendRevalidateNode(nodeId, nodePath, repoId) {
    let contentPath = nodePath.replace(/\/content\/[^\s\/]+/, '');
    if (!contentPath || contentPath.trim().length === 0) {
        contentPath = '/';
    }

    const site = getSite(nodeId, repoId);

    // do not debounce this one, because we need to send every individual revalidate request
    sendRevalidateRequest(contentPath, site, repoId);
}

function sendRevalidateRequest(contentPath, site, repoId) {
    log.debug('Requesting revalidation of [' + (contentPath || 'everything') + ']...');

    const projectName = getProjectName(repoId);
    let response = doSendRequest('/api/revalidate', contentPath, site, projectName);

    if (response.status !== 200) {
        log.warning(`Revalidation of '${contentPath ?? 'everything'}' status: ${response.status}`);
    } else {
        log.debug(`Revalidation of [${contentPath ?? 'everything'}] done`);
    }
}

function doSendRequest(url, contentPath, site, projectName) {
    return httpClientLib.request({
        method: 'GET',
        url: getFrontendServerUrl(site) + url,
        // contentType: 'text/html',
        connectionTimeout: 5000,
        readTimeout: 5000,
        headers: {
            [XP_PROJECT_ID_HEADER]: projectName
        },
        queryParams: {
            path: contentPath,
            token: getFrontendServerToken(site),
        },
        followRedirects: true,
    });
}
