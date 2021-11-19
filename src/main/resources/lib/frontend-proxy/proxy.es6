const httpClientLib = require('/lib/http-client');

const { MAPPING_TO_THIS_PROXY, FROM_XP_PARAM } = require('./connection-config');
const { getBodyWithReplacedUrls, getPageContributionsWithBaseUrl } = require("./postprocessing");
const { relayUriParams, parseFrontendRequestPath } = require("./parsing");





const errorResponse = function(url, status, message, req) {
    if (status >= 400) {
        const msg = url
            ? `Not fetched from frontend (${url}): ${status} - ${message}`
            : `Proxy (${req.url}) responded: ${status} - ${message}`;
        log.error(msg);
    }

    return {
        contentType: 'text/plain',
        body: message,
        status,
    };
};



// This proxies both requests made to XP content item paths and to frontend-relative paths (below the proxy "mapping" MAPPING_TO_THIS_PROXY),
// and uses httpClientLib to make the same request from the frontend, whether its rendered HTML or frontend assets.
const proxy = function(req) {

    if (req.branch !== 'draft') {
        return errorResponse(null, 400, 'Frontend proxy only available at the draft branch.', req);
    }

    const { frontendRequestPath, xpSiteUrl, error } = parseFrontendRequestPath(req);
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

    try {
        const response = httpClientLib.request({
            url: frontendUrl,
            // contentType: 'text/html',
            connectionTimeout: 5000,

            headers: {
                //secret: "it's not a secret anymore!"
                [FROM_XP_PARAM]: "preview"
            },

            body: null, // JSON.stringify({ variables: {} }),
            followRedirects: req.mode !== 'edit',
        });

        if (!response) {
            return errorResponse(frontendUrl, 500, 'No response from HTTP client');
        }

        const status = response.status;
        const message = response.message;

        if (status >= 400) {
            log.info(`Error response from frontend for ${frontendUrl}: ${status} - ${message}`);
        }

        // Do not send redirect-responses to the content-studio editor view,
        // as it may cause iframe cross-origin errors
        if (req.mode === 'edit' && status >= 300 && status < 400) {
            return errorResponse(frontendUrl, status, 'Redirects are not supported in editor view');
        }

        const isOk =  response.status === 200;
        const isHtml = isOk && response.contentType.indexOf('html') !== -1;
        const isJs = isOk && response.contentType.indexOf('javascript') !== -1;

        if (isHtml || isJs) {
            response.body = getBodyWithReplacedUrls(req, response.body, `${xpSiteUrl}${MAPPING_TO_THIS_PROXY}/`);
        }
        if (isHtml) {
            response.pageContributions = getPageContributionsWithBaseUrl(response, xpSiteUrl);
        }
        if (!isHtml) {
            response.postProcess = false
        }

        return response;

    } catch (e) {
        log.error(e);
        return errorResponse(frontendUrl, 500, `Exception: ${e}`);
    }
};

exports.get = proxy

exports.handleError = proxy;
