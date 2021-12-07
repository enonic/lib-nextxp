const httpClientLib = require('/lib/http-client');

const {MAPPING_TO_THIS_PROXY, FROM_XP_PARAM, FROM_XP_PARAM_VALUES, XP_RENDER_MODE_HEADER, COMPONENT_SUBPATH_HEADER} = require(
    './connection-config');
const {
    extractSingleComponentHtmlIfNeeded,
    getBodyWithReplacedUrls,
    getPageContributionsWithBaseUrl
} = require("./postprocessing");
const {relayUriParams, parseFrontendRequestPath} = require("./parsing");


const errorResponse = function (url, status, message, req, renderSingleComponent) {
    if (status >= 400) {
        const msg = url
                    ? `Not fetched from frontend (${url}): ${status} - ${message}`
                    : `Proxy (${req.url}) responded: ${status} - ${message}`;
        log.error(msg);
    }

    return renderSingleComponent
           ? {
            contentType: 'text/html',
            body: `<div style="color:red;border: 1px solid red; background-color:white"><p>lib-frontend-proxy</p><h3>Component rendering error</h3><p>Status: ${status}</p><p>Message: ${message}</p></div>`,
            status: 200
        }
           : {
            contentType: 'text/plain',
            body: message,
            status,
        };
};


// This proxies both requests made to XP content item paths and to frontend-relative paths (below the proxy "mapping" MAPPING_TO_THIS_PROXY),
// and uses httpClientLib to make the same request from the frontend, whether its rendered HTML or frontend assets.
const proxy = function (req) {

    if (req.branch !== 'draft') {
        return errorResponse(null, 400, 'Frontend proxy only available at the draft branch.', req);
    }

    const {frontendRequestPath, xpSiteUrl, componentSubPath, error} = parseFrontendRequestPath(req);

    //if (componentSubPath !== undefined) log.info("componentSubPath: " + componentSubPath);

    if (error) {
        return {
            status: error
        };
    }

    /*
    const { FROM_XP_PARAM } = require('./connection-config');
    const isLoopback = req.params[FROM_XP_PARAM];
    if (isLoopback) {
        log.info(`Loopback to XP detected from path ${req.rawPath}`);
        return {
            contentType: 'text/html',
            body: `<div>Error: request to frontend looped back to XP</div>`,
            status: 200,
        };
    }
    */

    const frontendUrl = relayUriParams(req, frontendRequestPath);
    log.info(`Lib-frontend-proxy:\nUrl: ${frontendUrl}\nMode: ${req.mode}\n`);

    let renderSingleComponent = false;

    try {
        const headers = {
            [FROM_XP_PARAM]: req.headers[FROM_XP_PARAM] || FROM_XP_PARAM_VALUES.TYPE,
            [XP_RENDER_MODE_HEADER]: req.mode,
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
            url: frontendUrl,
            // contentType: 'text/html',
            connectionTimeout: 5000,
            headers,
            body: null, // JSON.stringify({ variables: {} }),
            followRedirects: req.mode !== 'edit',
        });

        if (!response) {
            return errorResponse(frontendUrl, 500, 'No response from HTTP client', undefined, renderSingleComponent);
        }

        const status = response.status;
        const message = response.message;

        if (status >= 400) {
            log.warning(`Error response from frontend for ${frontendUrl}: ${status} - ${message}`);
        }

        // Do not send redirect-responses to the content-studio editor view,
        // as it may cause iframe cross-origin errors
        if (req.mode === 'edit' && status >= 300 && status < 400) {
            return errorResponse(frontendUrl, status, 'Redirects are not supported in editor view', undefined, renderSingleComponent);
        }

        const isOk = response.status === 200;
        const isHtml = isOk && response.contentType.indexOf('html') !== -1;
        const isJs = isOk && response.contentType.indexOf('javascript') !== -1;

        //TODO: workaround for XP pattern controller mapping not picked up in edit mode
        const xpSiteUrlWithoutEditMode = xpSiteUrl.replace(/\/edit\//, '/inline/');

        if (isHtml) {
            response.body = extractSingleComponentHtmlIfNeeded(response.body);

            //log.info("<-- RESPONSE HTML:\n\n" + response.body + "\n");
        }
        if (isHtml || isJs) {
            response.body = getBodyWithReplacedUrls(req, response.body, `${xpSiteUrlWithoutEditMode}${MAPPING_TO_THIS_PROXY}/`);
        }
        if (isHtml) {
            response.pageContributions = getPageContributionsWithBaseUrl(response, xpSiteUrlWithoutEditMode);
        }
        if (!isHtml) {
            response.postProcess = false
        }

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
