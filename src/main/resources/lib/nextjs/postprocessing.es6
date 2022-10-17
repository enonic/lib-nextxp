/** Replace URL refs in both HTML, JS and JSON sources from pointing to frontend-urls to making them sub-urls below the extFrontendProxy service */
export const getBodyWithReplacedUrls = (req, body, proxyUrlWithSlash, isCss) => {
    // double slashes is the right way of escaping bracket!
    const cssUrlPattern = new RegExp(`url\\([ \r\n\t]*(['"\`])?\/([^'"\`]*)['"\`]?[ \r\n\t]*\\)`, "g");

    // Replace local absolute root URLs (e.g. "/_next/..., "/api/... etc)
    const nextApiPattern = new RegExp(`(['"\`])([^'"\` \n\r\t]*\/)((?:_next(?!\/image?)\/|api\/)[^'"\` \n\r\t]*)['"\`]`, "g");

    // Don't do next static urls replacement in css
    const result = isCss ?
        body :
        body.replace(nextApiPattern, `$1${proxyUrlWithSlash}$3$1`);

    // But do css urls replacement for every file type
    // Replace CSS urls in the following format: url('</some/url>')>
    // Do this for JS and HTML files as well to support:
    // import "../styles.css" in JS
    // <style>.style {}</style> in HTML
    // (Quotes are optional because next doesn't use them in production mode)
    return result.replace(cssUrlPattern, `url($1${proxyUrlWithSlash}$2$1)`);
}


export const getPageContributionsWithBaseUrl = (response, siteUrl) => {
    const pageContributions = response.pageContributions || {};
    return {
        ...pageContributions,
        headBegin: [
            ...(
                (typeof pageContributions.headBegin === 'string')
                    ? [pageContributions.headBegin]
                    : pageContributions.headBegin || []
            ).map(item => item.replace(/<base\s+.*?(\/>|\/base>)/g, '')),
            `<base href="${siteUrl}" />`
        ]
    };
}

// In cases of URLs like `.../_/component/...`, where we ONLY want to render the naked component, everything before and after the component must be stripped away
// (since Next.js doesn't offer a good way to do this dynamically).
// Next.js marks this by surrounding the single component with <details data-single-component-output="true"></details>

const htmlComponentOutputPattern = /<details data-single-component-output="true">((?:\n|\t|\r|.)*)<\/details>/im;
export const getSingleComponentHtml = (body) => {
    const matches = body.match(htmlComponentOutputPattern);
    if (matches?.length > 1) {
        return matches[1];  // 0 -- whole match, but we need the first match group
    } else {
        return body;
    }
}


