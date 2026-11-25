require('./setup');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const repo = 'com.enonic.cms.example';
let context = {repository: repo, branch: 'draft', authInfo: {principals: ['role:system.admin']}};
let appLeader = false;
const listeners = {};
const requests = [];
const lookups = [];
const modules = {
    '/lib/xp/cluster': {isLeader: () => appLeader},
    '/lib/xp/event': {listener: ({type, callback}) => listeners[type] = callback},
    '/lib/xp/project': {list: () => [{id: 'example'}]},
    '/lib/xp/node': {multiRepoConnect: () => ({query: () => ({hits: [{repoId: repo}]})})},
    '/lib/xp/context': {
        get: () => context,
        run(params, callback) {
            const previous = context;
            context = {...context, ...params};
            try { return callback(); } finally { context = previous; }
        }
    },
    '/lib/xp/content': {getSite(params) { lookups.push([context.repository, context.branch, params]); }},
    '/lib/http-client': {request(params) { requests.push(params); return {status: 200}; }}
};
const load = Module._load;
global.__ = {newBean: () => ({debounce: callback => callback()})};
let config, events;
try {
    Module._load = function (id, ...args) { return modules[id] || load.call(this, id, ...args); };
    config = require('../../main/resources/lib/nextxp/config.es6');
    events = require('../../main/resources/lib/nextxp/event.es6');
} finally {
    Module._load = load;
    delete global.__;
}
app.config = {'nextjs.live.url': 'https://live.example', 'nextjs.live.secret': 'live-token', 'nextjs.default.url': 'https://default.example'};

test('selects this app from singleton or array siteConfig and otherwise uses default', () => {
    const match = {applicationKey: app.name, config: {'nextjs-config': 'live'}};
    const other = {...match, applicationKey: 'other'};
    for (const siteConfig of [match, [other, match]]) {
        const site = {data: {siteConfig}};
        assert.equal(config.getFrontendServerUrl(site), 'https://live.example');
        assert.equal(config.getFrontendServerToken(site), 'live-token');
    }
    for (const siteConfig of [other, [], undefined]) {
        assert.equal(config.getFrontendServerUrl({data: {siteConfig}}), 'https://default.example');
    }
});

test('an existing subscriber revalidates after becoming app leader, including moves seen as a follower', () => {
    events.subscribe();
    const emit = (type, branch, id) => listeners['node.*']({type, data: {nodes: [{repo, branch, id, path: '/content/site/page'}]}});
    emit('node.updated', 'master', 'ignored');
    assert.equal(requests.length, 0);
    emit('node.moved', 'draft', 'moved');
    appLeader = true;
    emit('node.updated', 'master', 'published');
    assert.deepEqual(lookups, [[repo, 'master', {key: 'published'}], [repo, 'draft', {key: 'moved'}]]);
    assert.deepEqual(requests.map(request => request.queryParams.path), [null, '/page']);
});
