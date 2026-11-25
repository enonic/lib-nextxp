require('./setup');

const {test} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const site = {_name: 'demo', _path: '/demo'};
const portal = {getSite: () => site, getContent: () => null, pageUrl: () => '/xp/demo/'};
const http = {};
const tokens = new Map();
const stubs = {
    '/lib/xp/portal': portal,
    '/lib/xp/context': {get: () => ({})},
    '/lib/http-client': http,
    '/lib/cache': {newCache: () => ({getIfPresent: key => tokens.get(key), put: (key, value) => tokens.set(key, value)})},
};
const load = Module._load;
let proxy;
try {
    Module._load = function (id, ...args) { return stubs[id] || load.call(this, id, ...args); };
    proxy = require('../../main/resources/lib/nextxp/proxy.es6');
} finally {
    Module._load = load;
}

const request = path => ({branch: 'draft', mode: 'preview', method: 'GET', path, params: {}, cookies: {}});

test('error handler accepts the XP error and legacy direct request', () => {
    const req = {...request('/'), mode: 'live'};
    assert.equal(proxy.handleError({request: req}).status, 403);
    assert.equal(proxy.handleError(req).status, 403);
});

test('missing site and missing edit-mode content return 404', t => {
    const req = {...request('/xp/id'), mode: 'edit'};
    assert.equal(proxy.get(req).status, 404);
    t.mock.method(portal, 'getSite', () => null);
    assert.equal(proxy.get(req).status, 404);
});

test('caches preview token and relays a contentless HEAD data request', t => {
    const calls = [];
    http.request = req => {
        calls.push(req);
        return {status: 200, headers: calls.length === 1 ? {'set-cookie': '__prerender_bypass=abc; Path=/'} : {}};
    };
    assert.equal(proxy.getPage(request('/xp/demo/page')).status, 200);
    assert.match(calls[0].url, /\/api\/preview\?/);
    assert.equal(tokens.get('NEXTJS_TOKEN_demo'), 'abc');
    const head = path => proxy.head({...request(path), method: 'HEAD'});
    assert.equal(head('/xp/demo/_next/data/build/xp/demo/page.json').status, 200);
    assert.equal(new URL(calls[1].url).pathname, '/_next/data/build/page.json');
    assert.equal(calls[1].method, 'HEAD');
    assert.equal(calls[1].headers.cookie, '__prerender_bypass=abc');
    t.mock.method(portal, 'getContent', () => ({_path: '/demo/page'}));
    assert.equal(head('/xp/demo/page').status, 200);
    assert.equal(new URL(calls[2].url).pathname, '/api/renderable');
});
