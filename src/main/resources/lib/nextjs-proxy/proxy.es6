const httpClientLib = require('/lib/http-client');

const {
    FROM_XP_PARAM,
    FROM_XP_PARAM_VALUES,
    XP_RENDER_MODE_HEADER,
    COMPONENT_SUBPATH_HEADER,
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
    log.info(`---> REQUEST:\n\nUrl: ${frontendUrl}\nMode: ${req.mode}\n\n`);

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
        //log.info(`-->\nfrontendUrl: ${frontendUrl}\nheaders:` + JSON.stringify(headers, null, 2));

        const response = httpClientLib.request({
            method: req.method,
            url: frontendUrl,
            // contentType: 'text/html',
            connectionTimeout: 5000,
            headers,
            body: null, // JSON.stringify({ variables: {} }),
            followRedirects: req.mode !== 'edit',
        });

        const isOk = response.status === 200;

        const isHtml = response.contentType.indexOf('html') !== -1;
        const isJs = response.contentType.indexOf('javascript') !== -1;

        //TODO: workaround for XP pattern controller mapping not picked up in edit mode
        const xpSiteUrlWithoutEditMode = xpSiteUrl.replace(/\/edit\//, '/inline/');

        if (isHtml) {
            response.body = renderSingleComponent
                            ? getSingleComponentHtml(response.body)
                            : response.body;

            response.pageContributions = getPageContributionsWithBaseUrl(response, xpSiteUrlWithoutEditMode);

        }
        if (isHtml || isJs) {
            response.body = getBodyWithReplacedUrls(req, response.body, xpSiteUrlWithoutEditMode);
        }

        response.postProcess = isHtml


        log.info("<--- RESPONSE\n\nUrl: " + frontendUrl + "\nstatus: " + response.status + "\ncontentType:" + response.contentType +
                 "\nrenderSingleComponent:" + renderSingleComponent + "\n");

        return (!isOk && renderSingleComponent)
               ? errorResponse(frontendUrl, response.status, response.message, undefined, true)
               : response;

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
