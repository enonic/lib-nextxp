const httpClientLib = require('/lib/http-client');
const portalLib = require('/lib/xp/portal');
const cacheLib = require('/lib/cache');

const {
    FROM_XP_PARAM,
    FROM_XP_PARAM_VALUES,
    XP_RENDER_MODE_HEADER,
    COMPONENT_SUBPATH_HEADER, removeEndSlashPattern,
} = require('./connection-config');
const {getSingleComponentHtml, getBodyWithReplacedUrls, getPageContributionsWithBaseUrl} = require("./postprocessing");
const {relayUriParams, parseFrontendRequestPath} = require("./parsing");

const NEXT_DATA_URL_PATTERN = '/_next/data';
const NEXT_DATA = '__next_preview_data';
const NEXT_TOKEN = '__prerender_bypass';
const COOKIE_CACHE = cacheLib.newCache({
    size: 300,   // good enough for 100 sites with 3 render modes per site
    expire: 3600,
});
const ALLOWED_RESPONSE_HEADERS = [
    'content-security-policy'
];


let COOKIE_DATA_KEY;
let COOKIE_TOKEN_KEY;


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
            if (!cookie?.length) {
                return;
            }
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
        headers,
    }
}

function doRequest(originalReq, frontendRequestPath, xpSiteUrl, componentSubPath, siteConfig, counter) {

    let nextjsToken = getNextjsTokenCookie();
    const nextjsData = getNextjsDataCookie();
    const hadNextCookies = !!nextjsToken && !!nextjsData;
    let frontendUrl = relayUriParams(originalReq, frontendRequestPath, hadNextCookies, componentSubPath, siteConfig);

    // When requesting /_next/data, the location is taken from url and will contain
    // xp base url (i.e. /admin/site/next/inline/hmdb/page.json)
    // that needs to be removed before sending to next server
    // NB: frontpage will have no trailing slash so remove it first!
    if (frontendUrl.contains(NEXT_DATA_URL_PATTERN)) {
        const xpSiteUrlWithoutTrailingSlash = xpSiteUrl.replace(removeEndSlashPattern, '');
        frontendUrl = frontendUrl.replace(xpSiteUrlWithoutTrailingSlash, '');
    }

    if (!nextjsToken) {
        log.debug('No nextjs token cached, getting one at: ' + frontendUrl);
    } else if (!nextjsData) {
        log.debug('Nextjs token is present, but there is no data for ' + originalReq.mode + ' mode cached, so getting one at: ' + frontendUrl);
    }
    let renderSingleComponent = false;

    if (counter >= 10) {
        const message = 'Request recursion limit exceeded: ' + counter;
        log.error(message);
        return errorResponse(frontendUrl, 500, message, originalReq, renderSingleComponent);
    }

    const headers = {
        [FROM_XP_PARAM]: getFromXPParam(originalReq),
        [XP_RENDER_MODE_HEADER]: originalReq.mode,
        xpBaseUrl: xpSiteUrl,
        jsessionid: originalReq.cookies['JSESSIONID']
    };
    if (hadNextCookies) {
        log.debug(`Using cached nextjs token [${COOKIE_TOKEN_KEY}] = ${nextjsToken} for: ${frontendUrl}`);
        headers['cookie'] = `${NEXT_TOKEN}=${nextjsToken}; ${NEXT_DATA}=${nextjsData}`;
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
        connectionTimeout: 30000,
        readTimeout: 30000,
        headers,
        body: null, // JSON.stringify({ variables: {} }),
        followRedirects: false,  // we handle it manually to control headers
    }

    log.debug(`---> [${originalReq.mode}]: ${frontendUrl}`);

    try {
        const response = httpClientLib.request(proxyRequest);

        processNextjsSetCookieHeader(response, frontendUrl);

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
            log.debug(`Following redirect to: ${response.headers['location']}`);

            return doRequest(originalReq, frontendRequestPath, xpSiteUrl, componentSubPath, siteConfig, ++counter);
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
            log.debug(`Renewing nextjs cookies [${COOKIE_DATA_KEY}] at: ${frontendUrl}`);

            return doRequest(originalReq, frontendRequestPath, xpSiteUrl, componentSubPath, siteConfig, ++counter);
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
            response.body = getBodyWithReplacedUrls(originalReq, response.body, xpSiteUrlWithoutEditMode, isCss, siteConfig);
        }

        response.postProcess = isHtml


        log.debug(`<--- [${response.status}]: ${frontendUrl}
                contentType: ${response.contentType}
                singleComponent: ${renderSingleComponent}`);

        return (!isOk && renderSingleComponent)
            ? errorResponse(frontendUrl, response.status, response.message, proxyRequest, true)
            : okResponse(response);


    } catch (e) {
        log.error(e);
        return errorResponse(frontendUrl, 500, `Exception: ${e}`, undefined, renderSingleComponent);
    }
}

function processNextjsSetCookieHeader(response, frontendUrl) {
    const cookieArray = response.headers['set-cookie'];

    if (cookieArray?.length > 0) {
        let cookieObject = cookiesArrayToObject(cookieArray);

        const nextToken = cookieObject[NEXT_TOKEN];
        const nextData = cookieObject[NEXT_DATA];

        if (nextToken?.length && nextData?.length) {
            setNextjsTokenCookie(nextToken);
            setNextjsDataCookie(nextData);

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
    const content = portalLib.getContent() || {};
    const siteConfig = portalLib.getSiteConfig();

    const {frontendRequestPath, xpSiteUrl, componentSubPath, error} = parseFrontendRequestPath(req, site, content);

    if (error) {
        return {
            status: error
        };
    }

    initNextjsCookieName(req, site);

    return doRequest(req, frontendRequestPath, xpSiteUrl, componentSubPath, siteConfig, 0);
};

function getNextjsDataCookie() {
    return COOKIE_CACHE.get(COOKIE_DATA_KEY, () => undefined);
}

function getNextjsTokenCookie() {
    return COOKIE_CACHE.get(COOKIE_TOKEN_KEY, () => undefined);
}

function setNextjsDataCookie(data) {
    removeNextjsDataCookie(true);
    log.debug(`Caching nextjs data [${COOKIE_DATA_KEY}]`);
    return COOKIE_CACHE.get(COOKIE_DATA_KEY, () => data);
}

function setNextjsTokenCookie(token) {
    removeNextjsTokenCookie(true);
    log.debug(`Caching nextjs token [${COOKIE_TOKEN_KEY}] = ${token}`);
    return COOKIE_CACHE.get(COOKIE_TOKEN_KEY, () => token);
}

function initNextjsCookieName(request, site) {
    COOKIE_DATA_KEY = `NEXTJS_DATA_FOR_${request.mode}_AT_${site._name}`;
    COOKIE_TOKEN_KEY = `NEXTJS_TOKEN_AT_${site._name}`;
}

function removeNextjsDataCookie(silent) {
    if (!silent) {
        log.debug(`Removing nextjs data [${COOKIE_DATA_KEY}]`);
    }
    COOKIE_CACHE.remove(COOKIE_DATA_KEY);
}

function removeNextjsTokenCookie(silent) {
    if (!silent) {
        log.debug(`Removing nextjs token [${COOKIE_TOKEN_KEY}]`);
    }
    COOKIE_CACHE.remove(COOKIE_TOKEN_KEY);
}

function getFromXPParam(req) {
    return req.headers[FROM_XP_PARAM] || FROM_XP_PARAM_VALUES.TYPE;
}

exports.get = proxy

exports.handleError = proxy;

exports.getPage = function (req) {
    req.headers = req.headers || {};
    req.headers[FROM_XP_PARAM] = FROM_XP_PARAM_VALUES.PAGE;

    return proxy(req);
}
