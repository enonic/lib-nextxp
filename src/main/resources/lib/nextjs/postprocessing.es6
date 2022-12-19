/** Replace URL refs in both HTML, JS and JSON sources from pointing to frontend-urls to making them sub-urls below the extFrontendProxy service */
import {getFrontendServerUrl, removeEndSlashPattern} from "./connection-config";

const wSpaces = '[ \\r\\n\\t]*';

export const getBodyWithReplacedUrls = (req, body, proxyUrlWithSlash, isCss, config) => {
    let result;
    if (!isCss) {
        // Replace next static URLs (e.g. "/_next/..., "/api/... etc)
        result = replaceNextApiUrls(body, proxyUrlWithSlash, config);
    } else {
        // Don't do next static urls replacement in css
        result = body;
    }

    // Do css urls replacement for every file type
    return replaceCssUrls(result, proxyUrlWithSlash);
}

const replaceCssUrls = (body, proxyUrlWithSlash) => {
    // double slashes is the right way of escaping parentheses!
    const cssUrlPattern = new RegExp(`url\\(${wSpaces}(['"\`])?\/([^'"\`]*)['"\`]?${wSpaces}\\)`, "g");

    // Replace CSS urls in the following format: url('</some/url>')>
    // Do this for JS and HTML files as well to support:
    // import "../styles.css" in JS
    // <style>.style {}</style> in HTML
    // (Quotes are optional because next doesn't use them in production mode)
    return body.replace(cssUrlPattern, `url($1${proxyUrlWithSlash}$2$1)`)
}

const replaceNextApiUrls = (body, proxyUrlWithSlash, config) => {
    const nextApiPattern = new RegExp(`(URL\\(${wSpaces})?(['"\`])([^'"\` \n\r\t]*\/)((?:_next\/(?!image)|api\/)[^'"\` \n\r\t]*)['"\`]`, "gmi");
    const frontendServerUrl = getFrontendServerUrl(config);
    // groups:
    // 1 - url(
    // 2 - "
    // 3 - domain
    // 4 - location
    const replacerFn = (substring, g1, g2, g3, g4) => {
        return `${g2}${buildFullUrl(substring, !!g1, g3, g4, frontendServerUrl, proxyUrlWithSlash)}${g2}`;
    };
    return body.replace(nextApiPattern, replacerFn);
}

const buildFullUrl = (substring, isUrlConstructor, linkDomain, linkLocation, frontendDomain, proxyUrlWithSlash) => {
    let result;
    if (isUrlConstructor || linkDomain.replace(removeEndSlashPattern, '') === frontendDomain) {
        // keep the link, as it is an url constructor (can't be relative) or has absolute direct url to frontend
        result = linkDomain;
    } else {
        result = proxyUrlWithSlash;
    }

    return result + linkLocation;
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


