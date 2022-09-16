const httpClientLib = require('/lib/http-client');
const portalLib = require('/lib/xp/portal');
const cacheLib = require('/lib/cache');

const {
    FROM_XP_PARAM,
    FROM_XP_PARAM_VALUES,
    XP_RENDER_MODE_HEADER,
    COMPONENT_SUBPATH_HEADER,
} = require('./connection-config');
const {getSingleComponentHtml, getBodyWithReplacedUrls, getPageContributionsWithBaseUrl} = require("./postprocessing");
const {relayUriParams, parseFrontendRequestPath} = require("./parsing");

const NEXT_DATA = '__next_preview_data';
const NEXT_TOKEN = '__prerender_bypass';
const COOKIE_CACHE = cacheLib.newCache({
    size: 300,   // good enough for 100 sites with 3 render modes per site
    expire: 3600,
});


let COOKIE_KEY;


const errorResponse = function (url, status, message, req, renderSingleComponent) {
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
            const indexEq = cookie.indexOf("=");
            if (indexEq > 0) {
                const indexSc = cookie.indexOf(";");
                cookies[cookie.substring(0, indexEq)] = cookie.substring(indexEq + 1, indexSc > 0 ? indexSc : undefined);
            }
        });
    }
    return cookies;
}

// lib-http response is different from the one controller awaits
function okResponse(libHttpResponse) {
    return {
        body: libHttpResponse.body || libHttpResponse.bodyStream,
        status: libHttpResponse.status,
        contentType: libHttpResponse.contentType,
        headers: libHttpResponse.headers,
    }
}

function doRequest(originalReq, frontendRequestPath, xpSiteUrl, componentSubPath, siteConfig) {

    let nextjsCookies = getNextjsCookies();
    const frontendUrl = relayUriParams(originalReq, frontendRequestPath, !!nextjsCookies, componentSubPath, siteConfig);

    let renderSingleComponent = false;

    const headers = {
        [FROM_XP_PARAM]: originalReq.headers[FROM_XP_PARAM] || FROM_XP_PARAM_VALUES.TYPE,
        [XP_RENDER_MODE_HEADER]: originalReq.mode,
        xpBaseUrl: xpSiteUrl
    };
    if (nextjsCookies) {
        log.debug(`Using cached nextjs cookies [${COOKIE_KEY}] for: ${frontendUrl}`);
        headers['cookie'] = nextjsCookies;
    }
    if (componentSubPath) {
        headers[COMPONENT_SUBPATH_HEADER] = componentSubPath;

        // If a component path has been parsed from the URL, it's most likely a single-component render request during update in edit mode.
        // Set the header to 'component' to signify that, except if it's the page at the root of the component tree.
        if (componentSubPath !== '' && componentSubPath !== '/') {
            headers[FROM_XP_PARAM] = FROM_XP_PARAM_VALUES.COMPONENT;
            renderSingleComponent = true;
        }
    }

    const proxyRequest = {
        method: originalReq.method,
        url: frontendUrl,
        // contentType: 'text/html',
        connectionTimeout: 10000,
        readTimeout: 10000,  // had to increase this to be able to run regexp replacing in postprocessing.es6
        headers,
        body: null, // JSON.stringify({ variables: {} }),
        followRedirects: false,  // we handle it manually to control headers
    }

    log.debug(`---> [${originalReq.mode}]: ${frontendUrl}`);

    try {
        const response = httpClientLib.request(proxyRequest);

        processNextjsSetCookieHeader(response);

        nextjsCookies = getNextjsCookies();

        if (!nextjsCookies?.length) {
            // nextjs cookies have probably expired and server returned empty ones
            // make a new preview request to get new nextjs cookies
            log.debug(`Renewing nextjs cookies [${COOKIE_KEY}] at: ${frontendUrl}`);

            return doRequest(originalReq, frontendRequestPath, xpSiteUrl, componentSubPath, siteConfig);
        }

        if (response.status >= 300 && response.status < 400 && nextjsCookies) {
            // it is a 3xx redirect
            // http client does not seem to set set-cookie header
            // so we do it manually instead of followRedirect: true
            log.debug(`Following redirect to: ${response.headers['location']}`);

            return doRequest(originalReq, frontendRequestPath, xpSiteUrl, componentSubPath, siteConfig);
        }

        const isOk = response.status === 200;
        const contentType = response.contentType;
        const isHtml = contentType.indexOf('html') !== -1;
        const isJs = contentType.indexOf('javascript') !== -1;
        const isCss = (contentType.indexOf('stylesheet') !== -1)
            || (contentType.indexOf('text/css') !== -1);

        //TODO: workaround for XP pattern controller mapping not picked up in edit mode
        const xpSiteUrlWithoutEditMode = xpSiteUrl.replace(/\/edit\//, '/inline/');

        if (isHtml) {
            response.body = renderSingleComponent
                ? getSingleComponentHtml(response.body)
                : response.body;

            response.pageContributions = getPageContributionsWithBaseUrl(response, xpSiteUrlWithoutEditMode);

        }

        if (isHtml || isJs || isCss) {
            response.body = getBodyWithReplacedUrls(originalReq, response.body, xpSiteUrlWithoutEditMode);
        }

        response.postProcess = isHtml


        log.debug(`<--- [${response.status}]: ${frontendUrl}
                contentType: ${response.contentType}
                singleComponent: ${renderSingleComponent}`);

        return (!isOk && renderSingleComponent)
            ? errorResponse(frontendUrl, response.status, response.message, undefined, true)
            : okResponse(response);


    } catch (e) {
        log.error(e);
        return errorResponse(frontendUrl, 500, `Exception: ${e}`, undefined, renderSingleComponent);
    }
}

function processNextjsSetCookieHeader(response) {
    const cookieArray = response.headers['set-cookie'];

    if (cookieArray?.length > 0) {
        let cookieObject = cookiesArrayToObject(cookieArray);

        const nextToken = cookieObject[NEXT_TOKEN];
        const nextData = cookieObject[NEXT_DATA];

        if (nextToken?.length && nextData?.length) {

            const nextCookies = Object.keys({
                [NEXT_TOKEN]: nextToken,
                [NEXT_DATA]: nextData,
            })
                .map(name => `${name}=${cookieObject[name]}`)
                .join("; ");

            setNextjsCookies(nextCookies);

        } else if (nextToken !== undefined) {
            // next token is empty, usually happens when the token has changed on server
            // filter empty cookies out

            removeNextjsCookies();
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
    const content = portalLib.getContent() || {};
    const siteConfig = portalLib.getSiteConfig();

    const {frontendRequestPath, xpSiteUrl, componentSubPath, error} = parseFrontendRequestPath(req, site, content);

    if (error) {
        return {
            status: error
        };
    }

    initNextjsCookieName(req.mode, site);

    return doRequest(req, frontendRequestPath, xpSiteUrl, componentSubPath, siteConfig);
};

function getNextjsCookies() {
    return COOKIE_CACHE.get(COOKIE_KEY, () => undefined);
}

function setNextjsCookies(cookies) {
    removeNextjsCookies(true);
    log.debug(`Caching nextjs cookies [${COOKIE_KEY}]`);
    return COOKIE_CACHE.get(COOKIE_KEY, () => cookies);
}

function initNextjsCookieName(requestMode, site) {
    COOKIE_KEY = `NEXTJS_COOKIE_FOR_${requestMode}_OF_${site._name}`;
}

function removeNextjsCookies(silent) {
    if (!silent) {
        log.debug(`Removing nextjs cookies [${COOKIE_KEY}]`);
    }
    COOKIE_CACHE.remove(COOKIE_KEY);
}

exports.get = proxy

exports.handleError = proxy;

exports.getPage = function (req) {
    req.headers = req.headers || {};
    req.headers[FROM_XP_PARAM] = FROM_XP_PARAM_VALUES.PAGE;

    return proxy(req);
}
