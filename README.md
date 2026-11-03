# @agora-build/chisel-dev

Framework-agnostic dev panel for visual annotation and UI editing by anyone, including AI agents. Live CSS variable editing, custom CSS injection, content editing, and annotated task routing to AI coding agents. Works with React, Vue, Svelte, or vanilla HTML.

## Features

- **Theme editor** -- auto-detects CSS custom properties from your stylesheets, with color pickers and text inputs
- **CSS editor** -- inject arbitrary CSS, applied instantly
- **Content editor** -- pick any text element on the page, edit it, apply the change
- **Icons tab** -- pick SVG icons, detect library (Lucide/FontAwesome/Material), rewrite source files
- **Mark tab** -- draw annotations on a page screenshot and send them to an AI agent for implementation
- **Save to file** -- writes changes back to your source files (CSS variables and text content)
- **Save & commit** -- saves and creates a git commit in one click
- **Persistent** -- overrides survive page refresh via localStorage
- **Zero runtime deps** -- vanilla JS core, optional React wrapper

## Install

```bash
npm install @agora-build/chisel-dev
```

## Quick Start

### Vanilla JS

```js
import { mountPanel } from "@agora-build/chisel-dev";

mountPanel(); // toggle with Ctrl+Shift+D
```

### React

```tsx
import { ChiselPanel } from "@agora-build/chisel-dev/react";

function App() {
  return (
    <>
      {/* your app */}
      {import.meta.env.DEV && <ChiselPanel />}
    </>
  );
}
```

### Express Middleware (for save-to-file + mark tasks)

```ts
import express from "express";
import { chiselMiddleware } from "@agora-build/chisel-dev/middleware";

const app = express();
app.use(express.json({ limit: "12mb" })); // PNGs can be up to 8 MiB before base64.

if (process.env.NODE_ENV !== "production") {
  chiselMiddleware(app, {
    cssFile: "src/index.css",
    srcDirs: ["src"],
  });
}
```

### With Station (online agent routing)

```ts
chiselMiddleware(app, {
  cssFile: "src/index.css",
  srcDirs: ["src"],
  station: {
    origin: "https://station.agora.build",
    integrationId: "YOUR_INTEGRATION_ID",
    hostId: "YOUR_ATEM_DEVICE_ID",
    sessionId: "ses-REPLACE_WITH_TARGET_SESSION",
    routeId: "ui",
    routeRevision: 1,
    tokenEnv: "CHISEL_STATION_TOKEN",
  },
});
```

Use Node 20.17+ and set `CHISEL_STATION_TOKEN` in the **server** environment.
It must be an integration token approved for `agent.view` and `agent.prompt`.
Never use a `VITE_` or `NEXT_PUBLIC_` credential variable. The config belongs in
server code. A runnable server example is [examples/station.mjs](examples/station.mjs).

The selected Atem runtime and an existing Claude/Codex session must be online.
The runtime must enable hosting and explicitly approve the service in its launch
profile and route. `routeRevision` must match its `runtime.toml`; changing the
route or target process makes stale requests fail. Chisel fetches the selected
session's fresh process generation before sending; it never guesses a host.

Station's signed service grant needs `view`, `message`, `notify` and `prompt`,
including the host/session/project scopes. New native provisioning can opt in
with `markTasks: true`; existing grants do not gain permissions. Upgrade the
shared SDK and account membership verifiers before enrolling these operations.
Station PR #70 and its companion marks publisher keep the separate
`host-work-api` build gate off in normal and existing `hosted-agent-api` builds.
Permission agreement, verifier upgrades, native consent and live acceptance are
required before activation; existing approved dev hosted execution is unchanged.

"Ask Agent to Work on It" saves `.chisel/tasks/<id>.png` and `.json`, then sends
the actual PNG to Station's authenticated marks endpoint. Success means Atem
durably accepted the task. Node keeps the progress stream open after the browser
gets that response. `GET /api/dev/tasks` exposes the stored progress: queued,
blocked, submitted and `awaiting_result` (a finished turn still needs an explicit
correlated completion result). The legacy `astation.wsUrl` task-ID-only sender
now gives upgrade guidance instead of claiming success.

Delivery is online only. There is no automatic retry, offline queue or replay
after a server restart. If a reply is lost, local files and immutable IDs remain
for diagnosis; acceptance is marked uncertain. Check the original task before
creating another mark. Loss of progress after known acceptance is
`monitoring_lost`, not proof the task failed. Node and the target Atem must remain
running while delivery waits or runs. Monitoring is bounded to ten minutes;
acceptance has a 30-second timeout. Local completion cannot complete remote work.

## API

### `mountPanel(options?): DevPanel`

Mount the panel to the DOM. Returns a `DevPanel` instance with `mount()` and `unmount()` methods.

### `new DevPanel(options?)`

Create a panel instance without mounting. Call `panel.mount(target?)` to attach.

### `ChiselPanel` (React)

React component wrapper. Mounts on render, unmounts on cleanup. Accepts all `PanelOptions` as props.

### `chiselMiddleware(app, options?)`

Register save routes on an Express app or router. Adds these POST endpoints:

- `POST {apiPrefix}/save-styles` -- update CSS variables in source file
- `POST {apiPrefix}/save-content` -- find-and-replace text in source files
- `POST {apiPrefix}/save-icons` -- replace icon imports in source files
- `POST {apiPrefix}/save-mark` -- save PNG + task JSON, optionally send to Station and await durable acceptance
- `GET {apiPrefix}/tasks` -- inspect saved task and forwarding progress

`save-styles` and `save-content` accept `?commit=true` query param to auto-commit.

## Options

### PanelOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiPrefix` | `string` | `"/api/dev"` | API route prefix for save endpoints |
| `storageKey` | `string` | `"chisel-dev-panel"` | localStorage key for persisting overrides |
| `shortcut` | `object` | `{ ctrl: true, shift: true, key: "D" }` | Keyboard shortcut to toggle panel |
| `variables` | `VarGroup[]` | auto-detected | Explicit variable groups (skips auto-detection) |
| `position` | `"left" \| "right"` | `"right"` | Panel position |
| `width` | `number` | `380` | Panel width in pixels |

### MiddlewareOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cssFile` | `string` | `"src/index.css"` | Path to the CSS file to edit |
| `srcDirs` | `string[]` | `["src"]` | Directories to search for content/icon replacements |
| `extensions` | `string[]` | `[".tsx", ".ts", ".jsx", ".js", ".vue", ".svelte"]` | File extensions to search |
| `commitMessage` | `string` | `"style: update theme variables via chisel"` | Git commit message |
| `apiPrefix` | `string` | `"/api/dev"` | API route prefix |
| `station` | `StationConfig` | -- | Server-only authenticated online mark delivery |
| `astation` | `AstationConfig` | -- | Deprecated task-ID-only transport; returns upgrade guidance |

### StationConfig

| Option | Type | Description |
|--------|------|-------------|
| `origin` | `string` | Station HTTPS origin; HTTP only for loopback development |
| `integrationId` | `string` | Native-approved integration ID |
| `hostId` | `string` | Explicit target Atem device ID |
| `sessionId` | `string` | Existing Claude/Codex session ID |
| `routeId` | `string` | Approved route ID from the target's `runtime.toml` |
| `routeRevision` | `number` | Exact current route revision |
| `tokenEnv` | `string` | Name of the server environment variable containing the bearer token |

## How It Works

**Theme tab**: On mount, scans all `document.styleSheets` for CSS custom properties (`--*`). Groups them by prefix (`--sidebar-*` -> "Sidebar", `--chart-*` -> "Chart"). Detects color values (HSL, hex, rgb) and shows color pickers for those.

**CSS tab**: Creates a `<style>` element and updates its `textContent` on every keystroke.

**Content tab**: Uses `document.addEventListener("click", ..., true)` in capture phase to intercept clicks during pick mode. Stores original/replacement pairs and sends them to the middleware for find-and-replace in source files.

**Icons tab**: Pick SVG icons from the page, detect their library (Lucide, FontAwesome, Material), type a replacement name, and rewrite the import in source files.

**Mark tab**: Draw annotations on the page and capture them in a PNG. Clicking
"Ask Agent to Work on It" saves the annotated PNG and task metadata locally.
If Station is configured, the server sends PNG bytes and typed annotations
through the authenticated API. Atem uses its ordinary agent-message queue.

**Save**: The middleware receives variable overrides and does regex replacement in the CSS file (`--name: oldvalue;` -> `--name: newvalue;`). Content changes are string-replaced across all files in the configured source directories.

## Mark Task Flow

```
Browser (Chisel Dev panel)
  ↓ User draws annotations, clicks "Ask Agent to Work on It"
  ↓ POST /api/dev/save-mark
Express middleware
  ↓ Saves .chisel/tasks/{taskId}.json + .png
  ↓ Authenticated session lookup, then POST PNG + metadata to configured Station
Station online marks API
  ↓ Current token/policy/service membership and exact target checks
  ↓ Encrypted R9 attachment_put chunks, then message_publish
Atem
  ↓ Verifies PNG, stores task, returns durable acceptance
  ↓ Shared FIFO queue → ready Claude/Codex session with local PNG path
  ↓ Work receipt progress → Station NDJSON stream → Node task JSON
```

## Development Tests

`npm test` builds the package and tests PNG validation, authenticated upload,
fragmented progress, durable acceptance, uncertainty and preservation of local
files without retries. Station's isolated HTTP/R9 suite can invoke the real
sender with `CHISEL_MARK_TEST_SCRIPT=/absolute/chisel/tests/station-live.mjs`.
The tests use fixture credentials and no live coding-provider APIs.

## Entry Points

| Import | Description |
|--------|-------------|
| `@agora-build/chisel-dev` | Client: `mountPanel()`, `DevPanel`, utilities |
| `@agora-build/chisel-dev/middleware` | Server: `chiselMiddleware()` |
| `@agora-build/chisel-dev/react` | React: `<ChiselPanel />` |

## Related Projects

- [Astation](https://github.com/Agora-Build/Astation) -- macOS menubar hub that coordinates Chisel, Atem, and AI agents — talk to your coding agent from anywhere
- [Atem](https://github.com/Agora-Build/Atem) -- A terminal that connects people, Agora platform, and AI agents
- [Vox](https://github.com/Agora-Build/Vox) -- AI latency evaluation platform

## License

MIT
