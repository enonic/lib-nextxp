# lib-frontend-proxy

XP-side proxy that can relay rendering to an external server (using it to render the frontend preview of a content item in content studio).

<br />

----

<br />

## Usage / install in XP project:

1. Add to XP project's _build.gradle_:

    ```groovy
    dependencies {
        include 'com.enonic.lib:lib-frontend-proxy:<version>'
    }
    ```
    
    For currently available `<version>`, see [the enonic public repo](https://repo.enonic.com/public/com/enonic/lib/lib-frontend-proxy/).
    
    <br />

2. Add to XP project's _site.xml_, under `<mappings>`:

    ```xml
    <mapping controller="/lib/frontend-proxy/proxy.js" order="99">            
        <match>type:'^(?!media:.*$).*'</match>
    </mapping>
    ```
   
    This is a controller mapping that matches _every_ content type except media types and maps the rendering to this lib's proxy, i.e. external rendering.

    <br />
 
    You might want to target content types more selectively here, if so edit the regex in `<match>` accordingly.

    <br />


### Configure frontend server URL

By default, this lib will assume the frontend server can be contacted on `http://localhost:3000`. To configure this, add an input field to _src/main/resources/site/**site.xml**_ in the host XP app project, inside `<form>`:

```xml
        <input name="frontendServerUrl" type="TextLine">
            <label>URL: frontend-rendering server</label>
            <occurrences minimum="1" maximum="1"/>
            <default>http://localhost:3000</default>
        </input>
```

Redeploy, open Content Studio, edit the site item, and on the app where you see the pencil icon, you can edit the URL in site settings.  

<br />

----

<br />

## Overview

The lib adds a proxy controller (_/lib/frontend-proxy/proxy.js_) that requires a [controller mapping](https://developer.enonic.com/docs/xp/stable/cms/mappings) in the host app's _site.xml_ (see "installation" above). Set the proxy up so it matches on
existing content items of selected type on path `<sitePath>/X/Y/Z` - so, usually <match>type. The proxy sends requests to `<frontendUrl>/X/Y/Z`, and handles any errors or returns the response so that is rendered as a preview in content studio.

HTML- and JS- responses from the frontend server will be postprocessed in order for asset URLs etc that target the frontend server will still work in CS preview. This happens by detecting frontend-server URLs (which consequently should always be absolute URLs - the frontend rendering must take care of that) and inserting a string value `"__frontendproxy__"` (`MAPPING_TO_THIS_PROXY` in connection-config.js - see also [issues](#issues) below), below XP's `<siteUrl>`. eg. `<frontendUrl>/asset/path` --> `<siteUrl>/__frontendproxy__/asset/path`.

For that reason, all links to other XP content items that should behave as in-CS-preview links, should be served from the frontend server _not_ as absolute URLs, but site-relative paths that _don't_ start with a slash.

<a id="behavior404"></a>
### 404 behavior:

- XP returns an XP-side 404 for paths that are non-existing content and not under `<xpSiteUrl>/__frontendproxy__/`.
- Frontend-server-related 404: if the proxy can't find the frontend rendering service (so the frontend server replies with a 404), this should be interpreted by the proxy as a server error (architecture problem), and trigger an error and an XP-side 500 response.
- Any other content/page-related 404 behaviour from the frontend server should be determined and rendered there so that the proxy can parse/detect the difference from frontend-server-related 404. Return the frontend-rendered 404 if any, or an XP-side 404.

<br />

----

<br />

## Lib development

### Local build:

```
./gradlew build
```

### Local publish:

```
./gradlew publishToMavenLocal
```

### Publish:

```
./gradlew publish
```


<br />

----

<br />

<a id="issues"></a>
## Issues:

https://github.com/enonic/lib-frontend-proxy/issues/

NOTE: Currently, until [this issue](https://github.com/enonic/lib-frontend-proxy/issues/7) is fixed, this alpha version won't work with XP 7.8+.
