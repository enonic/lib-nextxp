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

// <body> replaced with <body data-portal-component-type="page">, or <body class="edit" data-portal-component-type="page">
// (since Next.js doesn't offer a good way to do this dynamically).
// FIXME: This is WAY too vulnerable.
const bodyTagPattern = /<body(.*?)>/i;
export const getContentStudioAdaptedBodyTag = (body, requestRenderMode) => (
    body.replace(bodyTagPattern, `<body$1 ${requestRenderMode === "edit" ? 'class="edit" ':''}data-portal-component-type="page">`)
);

// In cases of URLs like `.../_/component/...`, where we ONLY want to render the naked component, everything before and after the component must be stripped away
// (since Next.js doesn't offer a good way to do this dynamically).
// Next.js marks this by surrounding the single component with <details data-remove-above="true"></details> and <details data-remove-below="true"></details>
const htmlBeginningPattern = /.*?<details data-remove-above="true"><\/details>\s*/i;
const htmlEndPattern = /\s*<details data-remove-below="true"><\/details>.*/i;
export const getSingleComponentHtml = (body) => (
    body
        .replace(htmlBeginningPattern, '')
        .replace(htmlEndPattern, '')
)


