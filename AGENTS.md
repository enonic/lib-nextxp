# AGENTS.md

This file provides guidance to coding agents (Claude Code, WARP, Codex, etc.) when working with code in this repository.

## Project Overview

lib-nextxp is an Enonic XP library that acts as a server-side proxy, relaying content rendering requests from XP Content Studio to an external Next.js frontend server. It enables preview of Next.js-rendered content directly inside Content Studio's edit/inline/preview modes.

The library is published as a Gradle artifact (`com.enonic.lib:lib-nextxp`) and consumed as a dependency by Enonic XP applications.

## Build Commands

- **Build**: `./gradlew build`
- **Publish to local Maven**: `./gradlew publishToMavenLocal`
- **Publish to remote**: `./gradlew publish`
- **Test**: `npm test`

The build uses Gradle with the `com.enonic.xp.base` plugin and `node-gradle` for Node.js tooling. The `babelLib` task transpiles ES6 source files from `src/main/resources/lib/nextxp/` into `build/resources/main/lib/nextxp/` using Babel, and runs automatically before `jar`.

## Testing

Unit tests live in `src/test/js/*.test.js` and run on the Node.js built-in test runner (`node --test`). They are **not** wired into the Gradle build — run `npm test` explicitly.

`src/test/js/setup.js` is the bootstrap every test file requires first. It stubs all `/lib/...` XP server modules as empty objects via a `Module._load` hook, defines the `log` and `app` globals, and registers `@babel/register` for the `.es6` extension so the library modules can be required directly.

String transformations can use the default stubs. For code that calls XP APIs, provide the relevant module behavior before loading the module under test; see `config-event.test.js` and `proxy.test.js`. These tests exercise library logic, not a live XP runtime.

## Architecture

### Source Layout

- `src/main/resources/lib/nextxp/*.es6` — JavaScript (ES6) library modules, transpiled by Babel to run inside the Enonic XP server (Nashorn/GraalJS). These use XP's `require()` module system alongside ES6 `import/export`.
- `src/main/java/` — Single Java class (`DebounceExecutor`) exposed to JS via `__.newBean()`.
- `src/test/js/` — Node.js unit tests plus the `setup.js` bootstrap (see Testing above).

### Core Modules

**proxy.es6** — Main entry point (`/lib/nextxp/proxy`). Exported as `exports.get`, `exports.handleError`, and `exports.getPage`. Handles the full proxy lifecycle:
1. Validates request is on `draft` branch and not `live` mode
2. Parses the request path to determine what to fetch from Next.js
3. Manages Next.js preview token cookies (cached via `lib-cache` with a 1-hour TTL)
4. Forwards requests using `lib-http-client`, following redirects manually to control headers
5. Post-processes HTML/JS/CSS responses to rewrite URLs from Next.js-relative to XP-relative paths
6. Extracts single component HTML when rendering individual components (via `/_/component/` paths)

**config.es6** — Configuration management. Reads `nextjs.<name>.url` and `nextjs.<name>.secret` from the XP app config (`app.config`). Falls back to `default` config name, then to `http://127.0.0.1:3000` / `mySecretKey`. Also resolves the XP project name from the current context repository.

**event.es6** — Content event system (`subscribe()` export). Listens for `node.*` and `repository.*` events to trigger Next.js revalidation via `/api/revalidate`. Call `subscribe()` on every app node, not just the leader. Each subscriber keeps its repository list and old paths current. On a qualifying `master` branch event, only the application leader (`cluster.isLeader()`) schedules bulk revalidation and sends individual requests for cached old paths. The Java `DebounceExecutor` runs the bulk request later without rechecking leadership.

**parsing.es6** — URL parsing and path resolution. Translates XP request paths to frontend-relative paths, handling edit mode (ID-based paths), component sub-paths, and query parameter serialization. Also builds the outgoing proxy URL with token and preview API parameters.

**postprocessing.es6** — Response body transformations. Rewrites Next.js asset URLs (`/_next/`, `/api/`) and CSS `url()` references to route through the XP proxy. Merges adjacent `self.__next_f.push()` flight segments first, so URLs split across RSC stream chunks are still matched. Injects a `<base>` tag into page contributions. Extracts single-component output from `<details data-single-component-output="true">` markers.

### Key Design Patterns

- URL rewriting must be idempotent. Response bodies mix frontend-relative URLs (`/_next/...`, which need the proxy prefix) with XP URLs that the frontend received from the content API and that already contain it (e.g. `/<proxy path>/_/media:attachment/...`). Prefixing the latter a second time produces a broken doubled path, so every rewrite pattern has to exclude URLs already pointing through the proxy.
- The proxy never follows HTTP redirects automatically (`followRedirects: false`); it re-issues requests manually to inject auth cookies/headers on each hop, with a recursion limit of 10.
- Multi-site support: cookie tokens are cached per site name (`NEXTJS_TOKEN_<siteName>`), and config supports named configurations (`nextjs.<name>.url/secret`) selectable per site via the `nextjs-config` site config field.
- The event system dynamically discovers which repositories have Next.js-enabled sites by querying all XP projects for sites with the app's `siteConfig`.

### XP API Dependencies

The code depends heavily on Enonic XP server-side libraries (imported via `require('/lib/xp/...')`): `portal`, `content`, `context`, `event`, `project`, `node`, `cluster`. Also uses `lib-http-client` and `lib-cache` from Enonic's ecosystem.
