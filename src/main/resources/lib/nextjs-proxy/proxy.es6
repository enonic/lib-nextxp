const httpClientLib = require('/lib/http-client');

const {
    FROM_XP_PARAM,
    FROM_XP_PARAM_VALUES,
    XP_RENDER_MODE_HEADER,
    COMPONENT_SUBPATH_HEADER,
    getFrontendServerUrl,
} = require('./connection-config');
const {getSingleComponentHtml, getBodyWithReplacedUrls, getPageContributionsWithBaseUrl} = require("./postprocessing");
const {relayUriParams, parseFrontendRequestPath} = require("./parsing");


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
        cookies: cookiesArrayToObject(libHttpResponse.cookies),
    }
}

function doRequest(req, renderSingleComponent) {
    const frontendUrl = req.url;
    const xpSiteUrl = req.headers['xpBaseUrl'];

    const response = httpClientLib.request(req);

    if (response.status >= 300 && response.status < 400) {
        // it is a 3xx redirect
        // http client does not seem to set set-cookie header
        // so we do it manually instead of followRedirect: true
        const redirectReq = Object.create(req);
        redirectReq.url = getFrontendServerUrl() + response.headers['location'];
        log.debug(`Following redirect to [${redirectReq.url}]:`);

        const setCookie = response.headers['set-cookie'];
        if (setCookie?.length > 0) {
            // execute set-cookie as a well-mannered client
            const cookies = cookiesArrayToObject(setCookie);
            redirectReq.headers['cookie'] = Object.keys(cookies).map(name => `${name}=${cookies[name]}`).join("; ");
        }

        return doRequest(redirectReq, renderSingleComponent);
    }


    const isOk = response.status === 200;
    const isHtml = response.contentType.indexOf('html') !== -1;
    const isJs = response.contentType.indexOf('javascript') !== -1;
    const isCss = response.contentType.indexOf('stylesheet') !== -1;

    //TODO: workaround for XP pattern controller mapping not picked up in edit mode
    const xpSiteUrlWithoutEditMode = xpSiteUrl.replace(/\/edit\//, '/inline/');

    if (isHtml) {
        response.body = renderSingleComponent
                        ? getSingleComponentHtml(response.body)
                        : response.body;

        response.pageContributions = getPageContributionsWithBaseUrl(response, xpSiteUrlWithoutEditMode);

    }

    if (isHtml || isJs || isCss) {
        response.body = getBodyWithReplacedUrls(req, response.body, xpSiteUrlWithoutEditMode);
    }

    response.postProcess = isHtml


    log.debug(`<--- [${response.status}]: ${frontendUrl}
                contentType: ${response.contentType}
                singleComponent: ${renderSingleComponent}`);

    return (!isOk && renderSingleComponent)
           ? errorResponse(frontendUrl, response.status, response.message, undefined, true)
           : okResponse(response);
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

    const {frontendRequestPath, xpSiteUrl, componentSubPath, error} = parseFrontendRequestPath(req);

    if (error) {
        return {
            status: error
        };
    }

    const frontendUrl = relayUriParams(req, frontendRequestPath);
    log.debug(`---> [${req.mode}]: ${frontendUrl}`);

    let renderSingleComponent = false;

    try {
        const headers = {
            [FROM_XP_PARAM]: req.headers[FROM_XP_PARAM] || FROM_XP_PARAM_VALUES.TYPE,
            [XP_RENDER_MODE_HEADER]: req.mode,
            xpBaseUrl: xpSiteUrl
        };
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
            method: req.method,
            url: frontendUrl,
            // contentType: 'text/html',
            connectionTimeout: 5000,
            readTimeout: 5000,  // had to increase this to be able to run regexp replacing in postprocessing.es6
            headers,
            body: null, // JSON.stringify({ variables: {} }),
            followRedirects: req.mode !== 'edit',  // we handle it manually in edit mode to handle set-cookie header
        }

        return doRequest(proxyRequest, renderSingleComponent);

    } catch (e) {
        log.error(e);
        return errorResponse(frontendUrl, 500, `Exception: ${e}`, undefined, renderSingleComponent);
    }
};

exports.get = proxy

exports.handleError = proxy;

exports.getPage = function (req) {
    req.headers = req.headers || {};
    req.headers[FROM_XP_PARAM] = FROM_XP_PARAM_VALUES.PAGE;

    return proxy(req);
}
