require('./setup');

const {test} = require('node:test');
const assert = require('node:assert/strict');

const {getBodyWithReplacedUrls} = require('../../main/resources/lib/nextxp/postprocessing.es6');

const PROXY_URL = '/admin/site/preview/projectname/draft/sitename/';
const PROXY_URL_NO_SLASH = '/admin/site/preview/projectname/draft/sitename';
const NEXTJS_URL = 'http://127.0.0.1:3000';

const replaceUrls = (body) => getBodyWithReplacedUrls({}, body, PROXY_URL, false, NEXTJS_URL);

test('rewrites quoted /_next URL in a script tag', () => {
    assert.equal(
        replaceUrls('<script src="/_next/static/chunks/whole.js" async=""></script>'),
        `<script src="${PROXY_URL_NO_SLASH}/_next/static/chunks/whole.js" async=""></script>`
    );
});

test('rewrites /_next URL split across two __next_f.push segments', () => {
    const body = '<script>self.__next_f.push([1,"3e:I[742957,[\\"/_"])</script>'
                 +
                 '<script>self.__next_f.push([1,"next/static/chunks/0bclolnkp2sjw.js\\",\\"/_next/static/chunks/0other.js\\"],\\"\\"]\\n"])</script>';

    assert.equal(
        replaceUrls(body),
        '<script>self.__next_f.push([1,"3e:I[742957,'
        + `[\\"${PROXY_URL_NO_SLASH}/_next/static/chunks/0bclolnkp2sjw.js\\",`
        + `\\"${PROXY_URL_NO_SLASH}/_next/static/chunks/0other.js\\"],\\"\\"]\\n"])</script>`
    );
});

test('rewrites root-relative manifest.json link href', () => {
    assert.equal(
        replaceUrls('<link rel="manifest" href="/manifest.json"/>'),
        `<link rel="manifest" href="${PROXY_URL_NO_SLASH}/manifest.json"/>`
    );
});

test('rewrites root-relative manifest.webmanifest link href', () => {
    assert.equal(
        replaceUrls('<link rel="manifest" href="/manifest.webmanifest"/>'),
        `<link rel="manifest" href="${PROXY_URL_NO_SLASH}/manifest.webmanifest"/>`
    );
});

test('rewrites manifest.json href in flight data with escaped quotes', () => {
    const result = replaceUrls(
        'self.__next_f.push([1,"[\\"$\\",\\"link\\",\\"2\\",{\\"rel\\":\\"manifest\\",\\"href\\":\\"/manifest.json\\"}]"])');
    assert.ok(
        result.includes(`\\"${PROXY_URL_NO_SLASH}/manifest.json\\"`),
        `expected rewritten manifest url in: ${result}`
    );
});
