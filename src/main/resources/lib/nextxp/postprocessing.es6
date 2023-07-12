/** Replace URL refs in both HTML, JS and JSON sources from pointing to frontend-urls to making them sub-urls below the extFrontendProxy service */
import {trailingSlashPattern} from "./config";
import {parseUrl} from "./parsing";

const wSpaces = '[ \\r\\n\\t]*';
const alphaNum = 'a-zA-Z0-9_\\.\\-';
const quotes = `['"\\\`]`

export const getBodyWithReplacedUrls = (req, body, proxyUrlWithSlash, isCss, nextjsUrl) => {
    let result;
    if (!isCss) {
        // Replace next static URLs (e.g. "/_next/..., "/api/... etc)
        result = replaceNextApiUrls(body, proxyUrlWithSlash, nextjsUrl);
    } else {
        // Don't do next static urls replacement in css
        result = body;
    }

    // Do css urls replacement for every file type
    return replaceCssUrls(result, proxyUrlWithSlash);
}

const replaceCssUrls = (body, proxyUrlWithSlash) => {
    // double slashes is the right way of escaping parentheses!
    const cssUrlPattern = new RegExp(`url\\(${wSpaces}(${quotes})?\/([^'"\`]*)${quotes}?${wSpaces}\\)`, "g");

    // Replace CSS urls in the following format: url('</some/url>')>
    // Do this for JS and HTML files as well to support:
    // import "../styles.css" in JS
    // <style>.style {}</style> in HTML
    // (Quotes are optional because next doesn't use them in production mode)
    return body.replace(cssUrlPattern, `url($1${proxyUrlWithSlash}$2$1)`)
}

const replaceNextApiUrls = (body, proxyUrlWithSlash, nextjsUrl) => {
    const nextApiPattern = new RegExp(`(URL\\(${wSpaces})?(${quotes})((?:https?:\/\/)?[${alphaNum}:]{3,})?([${alphaNum}\/]{2,})?(\/(?:_next(?!\/image)|api)[^'"\`]+)${quotes}`, "gmi");

    const parsedNextjsUrl = parseUrl(nextjsUrl);
    const proxyUrlWithoutSlash = proxyUrlWithSlash.replace(trailingSlashPattern, '');

    return body.replace(nextApiPattern, (match, url, quotes, domain, basePath, location) => {
        return buildFullUrl(match, !!url, quotes, domain, basePath, location, parsedNextjsUrl, proxyUrlWithoutSlash);
    });
}


const buildFullUrl = (match, isUrlConstructor, quotes, domain, basePath, location, parsedNextjsUrl, proxyUrlWithoutSlash) => {
    let result;
    let isAbsoluteFrontendUrl = domain === parsedNextjsUrl.domain;
    if (isUrlConstructor || isAbsoluteFrontendUrl) {
        // keep the link, as it is an url constructor (can't be relative) or has absolute url to frontend
        result = domain + (isAbsoluteFrontendUrl && basePath ? basePath : '');
    } else {
        result = proxyUrlWithoutSlash;
    }
    if (parsedNextjsUrl.basePath?.length && !basePath?.length) {
        // basePath is configured, but not present in the link
        // that means it will be added by nextjs in runtime,
        // so put a basePathBuster because xp doesn't need to have a basePath
        result = parsedNextjsUrl.basePathBuster + result
    }
    return `${quotes}${result + location}${quotes}`;
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


