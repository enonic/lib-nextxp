# trailingSlashPatternjs

XP-side proxy that can relay rendering to an external server (using it to render the frontend preview of a content item
in content studio).

The lib adds a proxy controller (_/lib/nextjs/proxy.js_) that requires
a [controller mapping](https://developer.enonic.com/docs/xp/stable/cms/mappings) in the host app's _site.xml_ (see "
installation" above).
The proxy sends requests to `<frontendUrl>/X/Y/Z`, and handles any errors or returns the response so that is rendered as
a preview in
content studio.

----

## Usage / install in XP project:

1. Add to XP project's _build.gradle_:

    ```groovy
    dependencies {
        include 'com.enonic.lib:lib-nextxp:<version>'
    }
    ```

   For currently available `<version>`, see [the enonic public repo](https://repo.enonic.com/public/com/enonic/lib/lib-frontend-proxy/).

    <br />

2. Add to XP project's _site.xml_ `<mappings>` section:

    ```xml
    <mapping controller="/lib/nextjs/proxy.js" order="99">
      <pattern>/.*</pattern>
    </mapping>
    ```

   This is a controller mapping that matches _every_ url and maps the rendering to this lib's proxy, i.e. external rendering.

    <br />

   Proxy can be invoked directly in page/component controllers as well:
   ```javascript
   var proxy = require('/lib/nextjs/proxy');
   
   exports.get = function (req) {
        return proxy.get(req);
   }
   ```

----

## Configure frontend server URL

By default, this lib will assume the frontend server can be contacted on `http://localhost:3000`.

To configure this, you can add/modify a config file named same as your XP application gradle name (i.e. `com.example.myproject.cfg`) with
the following line to `<xp-home>/config` folder:

   ```properties
    nextjsUrl=http://localhost:1234
   ```

_Changes to this file are applied immediately!_

----

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

----

<a id="issues"></a>
## Issues:

https://github.com/enonic/lib-nextxp/issues/

