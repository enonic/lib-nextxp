const {getFrontendServerUrl} = require("./connection-config")


/** Replace URL refs in both HTML, JS and JSON sources from pointing to frontend-urls to making them sub-urls below the extFrontendProxy service */
export const getBodyWithReplacedUrls = (req, body, proxyUrlWithSlash) => {

    const frontendServerUrl = getFrontendServerUrl();
    const nativeApiPattern = new RegExp(`(['"\`])(${frontendServerUrl}/)(_next(?!/image\?)/|api/)`, "g");
    const extRootPattern = new RegExp(`${frontendServerUrl}/?`, "g");

    const extFrontendProxyRoot = `$1${proxyUrlWithSlash}$3`;

    return body
        // Replace local absolute root URLs (e.g. "/_next/..., "/api/... etc):
        .replace(nativeApiPattern, extFrontendProxyRoot)
        .replace(extRootPattern, proxyUrlWithSlash)
}




export const getPageContributionsWithBaseUrl = (response, siteUrl) => {
    const pageContributions = response.pageContributions || {};
    return {
        ...pageContributions,
        headBegin: [
            ...(
                (typeof pageContributions.headBegin === 'string')
                    ?  [pageContributions.headBegin]
                    :  pageContributions.headBegin || []
            ).map(item => item.replace(/<base\s+.*?(\/>|\/base>)/g, '')),
            `<base href="${siteUrl}" />`
        ]
    };
}
