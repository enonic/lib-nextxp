const httpClientLib = require('/lib/http-client');
const portalLib = require('/lib/xp/portal');
const cacheLib = require('/lib/cache');

const {
    XP_RENDER_MODE_HEADER,
    XP_PROJECT_ID_HEADER,
    trailingSlashPattern,
    getFrontendServerUrl,
    getFrontendServerToken,
    getProjectName,
} = require('./config');
const {getSingleComponentHtml, getBodyWithReplacedUrls, getPageContributionsWithBaseUrl} = require("./postprocessing");
const {relayUriParams, parseFrontendRequestPath, serializeParams} = require("./parsing");

const NEXT_DATA_URL_PATTERN = '/_next/data';
const NEXT_TOKEN = '__prerender_bypass';
const COOKIE_CACHE = cacheLib.newCache({
    size: 900,   // good enough for 100 sites with 3 render modes per site and 3 sets of query params per page
    expire: 3600,
});
const ALLOWED_RESPONSE_HEADERS = [
    'content-security-policy'
];


let COOKIE_TOKEN_KEY;

const errorResponse = function (url, status, message, req, renderSingleComponent) {
    log.error(`Error response: ${status} - ${message}`);
    if (status >= 400) {
        const msg = url
            ? `Not fetched from frontend (${url}): ${status} - ${message}`
            : `Proxy (${req.url}) responded: ${status} - ${message}`;
        log.error(msg);
    }

    const componentErrorBody = `<div style="border: 2px solid red; padding: 16px;">
                                    <h3 style="margin: 0;">Component error: ${status}</h3>
                                    <p style="margin-bottom: 0; color: grey;">${message ? message : 'Unknown error'}</p>
                                </div>`;

    if (renderSingleComponent) {
        // catch non-handled nextjs errors when fetching single component
        return {
            contentType: 'text/html',
            body: componentErrorBody,
            status: 200
        }
    } else {
        return {
            contentType: 'text/plain',
            body: message,
            status,
        };
    }
};

function cookiesArrayToObject(array) {
    const cookies = {};
    if (array?.length > 0) {
        array.forEach(cookie => {
            cookie = cookie?.trim();
            if (!cookie?.length) {
                return;
            }
            const indexEq = cookie.indexOf("=");
            const indexSc = cookie.indexOf(";");
            if (indexEq > 0) {
                cookies[cookie.substring(0, indexEq)] = cookie.substring(indexEq + 1, indexSc);
            }
        });
    }
    return cookies;
}

function cookiesMapToString(obj) {
    return Object.keys(obj).map(key => `${key}=${obj[key]}`).join('; ');
}

// lib-http response is different from the one controller awaits
function okResponse(libHttpResponse) {
    let libHeaders = libHttpResponse.headers || {};

    // copy the listed headers
    const headers = Object.keys(libHeaders).reduce((all, header) => {
        if (ALLOWED_RESPONSE_HEADERS.indexOf(header) > -1) {
            all[header] = libHeaders[header];
        }
        return all;
    }, {});

    return {
        body: libHttpResponse.body || libHttpResponse.bodyStream,
        status: libHttpResponse.status,
        contentType: libHttpResponse.contentType,
        applyFilters: libHttpResponse.applyFilters || false,
        headers,
    }
}

function doRequest(requestContext, counter) {

    const {
        request: originalReq,
        xpSiteUrl,
        componentSubPath,
        nextjsUrl,
        projectName,
    } = requestContext;

    let nextjsToken = getNextjsTokenCookie();
    const hadNextCookies = !!nextjsToken;
    let frontendUrl = relayUriParams(requestContext, hadNextCookies);

    // When requesting /_next/data, the location is taken from url and will contain
    // xp base url (i.e. /admin/site/next/inline/hmdb/page.json)
    // that needs to be removed before sending to next server
    // NB: frontpage will have no trailing slash so remove it first!
    if (frontendUrl.contains(NEXT_DATA_URL_PATTERN)) {
        const xpSiteUrlWithoutTrailingSlash = xpSiteUrl.replace(trailingSlashPattern, '');
        frontendUrl = frontendUrl.replace(xpSiteUrlWithoutTrailingSlash, '');
    }

    const cookiesMap = originalReq.cookies;

    if (!hadNextCookies) {
        log.debug(`No nextjs token cached, getting one at: ${frontendUrl}`);
    } else {
        log.debug(`Using cached nextjs token [${COOKIE_TOKEN_KEY}]: ${nextjsToken}`);
        cookiesMap[NEXT_TOKEN] = nextjsToken;
    }

    const headers = {
        [XP_RENDER_MODE_HEADER]: originalReq.mode,
        [XP_PROJECT_ID_HEADER]: projectName,
        xpBaseUrl: xpSiteUrl,
        jsessionid: getJSessionId(originalReq),
        cookie: cookiesMapToString(cookiesMap)
    };

    let renderSingleComponent = componentSubPath && componentSubPath !== '' && componentSubPath !== '/';

    if (counter >= 10) {
        const message = `Request recursion limit exceeded: ${counter}`;
        log.error(message);
        return errorResponse(frontendUrl, 500, message, originalReq, renderSingleComponent);
    }

    log.debug(`REQUEST [${originalReq.method}]: ${frontendUrl}\n${JSON.stringify(headers, null, 2)}`);

    const proxyRequest = {
        method: originalReq.method,
        url: frontendUrl,
        // contentType: 'text/html',
        connectionTimeout: 30000,
        readTimeout: 30000,
        headers,
        body: null, // JSON.stringify({ variables: {} }),
        followRedirects: false,  // we handle it manually to control headers
    }

    try {
        const response = httpClientLib.request(proxyRequest);

        log.debug(`RESPONSE [${response.status}]: ${frontendUrl}
        headers:\n${JSON.stringify(response.headers, null, 2)}
        cookies:\n${JSON.stringify(response.cookies, null, 2)}`);

        if (response.status === 308 && !nextjsToken) {
            // it is a 308 permanent redirect
            // I.e. when trailing slash was set in config, but not present in request
            // we don't need to verify nextjs cookies here
            const redirectUrl = response.headers['location'];
            requestContext.redirectUrl = redirectUrl;
            log.debug(`Following redirect [${response.status}] to: ${redirectUrl}`);

            return doRequest(requestContext, ++counter);
        }

        processSetCookieHeader(requestContext.request, response);

        nextjsToken = getNextjsTokenCookie();

        if (!nextjsToken && !hadNextCookies) {
            // we did not have nextjs cookies and we couldn't obtain them
            let message = `Nextjs server did not return preview token`;

            // Try reading the response message
            if (response.message) {
                message = `${message}: ${response.message}`;
            } else {
                try {
                    const json = JSON.parse(response.body);
                    if (json?.message) {
                        message = `${message}: ${json.message}`;
                    }
                } catch (parseError) {
                }
            }

            return errorResponse(frontendUrl, response.status, message, proxyRequest, renderSingleComponent);
        }

        if (response.status >= 300 && response.status < 400 && nextjsToken) {
            // it is a 3xx redirect
            // http client does not seem to set set-cookie header
            // so we do it manually instead of followRedirect: true
            const redirectUrl = response.headers['location'];
            requestContext.redirectUrl = redirectUrl;
            log.debug(`Following redirect [${response.status}] to: ${redirectUrl}`);

            return doRequest(requestContext, ++counter);
        }

        const isVercelPrerender = response.headers['x-vercel-cache'] === 'PRERENDER';
        const isOk = response.status === 200;
        const contentType = response.contentType || '';
        const isHtml = contentType.indexOf('html') !== -1;
        const isJs = contentType.indexOf('javascript') !== -1;
        const isCss = (contentType.indexOf('stylesheet') !== -1)
            || (contentType.indexOf('text/css') !== -1);

        if (!nextjsToken?.length || isVercelPrerender && isHtml) {
            if (isVercelPrerender) {
                log.debug('Vercel returned static content instead of preview, the token had most likely expired');
                removeNextjsTokenCookie(true);
            }
            // nextjs cookies have probably expired and server returned empty ones
            // make a new preview request to get new nextjs cookies
            // remember to clear any redirect if present
            requestContext.redirectUrl = undefined;

            return doRequest(requestContext, ++counter);
        }

        //TODO: workaround for XP pattern controller mapping not picked up in edit mode
        const xpSiteUrlWithoutEditMode = xpSiteUrl.replace(/\/edit\//, '/inline/');

        if (isHtml) {
            if (response.body && renderSingleComponent) {
                response.body = getSingleComponentHtml(response.body);
            }
            response.pageContributions = getPageContributionsWithBaseUrl(response, xpSiteUrlWithoutEditMode);
        }

        if (response.body && (isHtml || isJs || isCss)) {
            response.body = getBodyWithReplacedUrls(originalReq, response.body, xpSiteUrlWithoutEditMode, isCss, nextjsUrl);
        }

        response.applyFilters = false

        return (!isOk && renderSingleComponent)
            ? errorResponse(frontendUrl, response.status, response.message, proxyRequest, true)
            : okResponse(response);


    } catch (e) {
        log.error(e);
        return errorResponse(frontendUrl, 500, `Exception: ${e}`, undefined, renderSingleComponent);
    }
}

function processSetCookieHeader(request, response) {
    let cookieArray = response.headers['set-cookie'];
    if (typeof cookieArray === 'string') {
        cookieArray = [].concat(cookieArray);
    }

    if (cookieArray?.length > 0) {
        let cookieObject = cookiesArrayToObject(cookieArray);
        Object.keys(cookieObject).forEach((key) => {
            request.cookies[key] = cookieObject[key];
        });

        const nextToken = cookieObject[NEXT_TOKEN];

        if (nextToken?.length) {
            setNextjsTokenCookie(nextToken);

        } else if (nextToken !== undefined) {
            // next token is empty, usually happens when the token has changed on server
            // filter empty cookies out

            removeNextjsTokenCookie();
        }
    }
}


// This proxies both requests made to XP content item paths and to frontend-relative paths (below the proxy "mapping" MAPPING_TO_THIS_PROXY),
// and uses httpClientLib to make the same request from the frontend, whether its rendered HTML or frontend assets.
const proxy = function (req) {

    if (req.branch !== 'draft') {
        return errorResponse(null, 400, 'Frontend proxy only available at the draft branch.', req);
    }

    if (req.mode === 'live') {
        return errorResponse(null, 403, 'Frontend proxy not available in live mode.', req);
    }

    const site = portalLib.getSite();

    const nextjsUrl = getFrontendServerUrl(site);
    const nextjsSecret = getFrontendServerToken(site);
    const projectName = getProjectName();

    const {frontendRequestPath, xpSiteUrl, componentSubPath, error, contentPath} = parseFrontendRequestPath(req, site);

    if (frontendRequestPath === '/_next/webpack-hmr') {
        //TODO: req.scheme is http, whereas it should have been ws, so can not use it for matching
        return errorResponse(frontendRequestPath, 501, 'WS:// requests are not supported yet', req);
    }

    log.debug('\n\nURL: ' + frontendRequestPath + (componentSubPath ? ' [' + componentSubPath + ']' : '') +
        '\nbasePath: ' + xpSiteUrl + '\nmode=' + req.mode + '\nbranch=' + req.branch + '\nproject=' + projectName + '\n');

    if (error) {
        return {
            status: error
        };
    }

    initNextjsCookieName(projectName, site);

    const requestContext = {
        request: req,
        frontendRequestPath,
        xpSiteUrl,
        componentSubPath,
        nextjsUrl,
        nextjsSecret,
        projectName,
        contentPath,
    }

    return doRequest(requestContext, 0);
};

const getJSessionId = function (req) {
    return req?.cookies['JSESSIONID'];
}

function getNextjsTokenCookie() {
    return COOKIE_CACHE.get(COOKIE_TOKEN_KEY, () => undefined);
}

function setNextjsTokenCookie(token) {
    removeNextjsTokenCookie(true);
    log.debug(`Caching nextjs token [${COOKIE_TOKEN_KEY}] = ${token}`);
    return COOKIE_CACHE.get(COOKIE_TOKEN_KEY, () => token);
}

function initNextjsCookieName(project, site) {
    // create separate data for different params too
    COOKIE_TOKEN_KEY = `NEXTJS_TOKEN_${site._name}`;
}

function removeNextjsTokenCookie(silent) {
    if (!silent) {
        log.debug(`Removing nextjs token [${COOKIE_TOKEN_KEY}]`);
    }
    COOKIE_CACHE.remove(COOKIE_TOKEN_KEY);
}

exports.get = proxy

exports.handleError = proxy;

exports.getPage = function (req) {
    req.headers = req.headers || {};

    return proxy(req);
}
