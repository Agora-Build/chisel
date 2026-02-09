# @agora-build/chisel-dev

Framework-agnostic dev style panel for live CSS variable editing, custom CSS injection, and content editing. Works with React, Vue, Svelte, or vanilla HTML.

## Features

- **Theme editor** — auto-detects CSS custom properties from your stylesheets, with color pickers and text inputs
- **CSS editor** — inject arbitrary CSS, applied instantly
- **Content editor** — pick any text element on the page, edit it, apply the change
- **Save to file** — writes changes back to your source files (CSS variables and text content)
- **Save & commit** — saves and creates a git commit in one click
- **Persistent** — overrides survive page refresh via localStorage
- **Zero runtime deps** — vanilla JS core, optional React wrapper

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

### Express Middleware (for save-to-file)

```ts
import express from "express";
import { chiselMiddleware } from "@agora-build/chisel-dev/middleware";

const app = express();
app.use(express.json());

if (process.env.NODE_ENV !== "production") {
  chiselMiddleware(app, {
    cssFile: "src/index.css",
    srcDirs: ["src"],
  });
}
```

## API

### `mountPanel(options?): DevPanel`

Mount the panel to the DOM. Returns a `DevPanel` instance with `mount()` and `unmount()` methods.

### `new DevPanel(options?)`

Create a panel instance without mounting. Call `panel.mount(target?)` to attach.

### `ChiselPanel` (React)

React component wrapper. Mounts on render, unmounts on cleanup. Accepts all `PanelOptions` as props.

### `chiselMiddleware(app, options?)`

Register save routes on an Express app or router. Adds two POST endpoints:

- `POST {apiPrefix}/save-styles` — update CSS variables in source file
- `POST {apiPrefix}/save-content` — find-and-replace text in source files

Both accept `?commit=true` query param to auto-commit.

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
| `srcDirs` | `string[]` | `["src"]` | Directories to search for content replacements |
| `extensions` | `string[]` | `[".tsx", ".ts", ".jsx", ".js", ".vue", ".svelte"]` | File extensions to search |
| `commitMessage` | `string` | `"style: update theme variables via chisel"` | Git commit message |
| `apiPrefix` | `string` | `"/api/dev"` | API route prefix |

## How It Works

**Theme tab**: On mount, scans all `document.styleSheets` for CSS custom properties (`--*`). Groups them by prefix (`--sidebar-*` -> "Sidebar", `--chart-*` -> "Chart"). Detects color values (HSL, hex, rgb) and shows color pickers for those.

**CSS tab**: Creates a `<style>` element and updates its `textContent` on every keystroke.

**Content tab**: Uses `document.addEventListener("click", ..., true)` in capture phase to intercept clicks during pick mode. Stores original/replacement pairs and sends them to the middleware for find-and-replace in source files.

**Save**: The middleware receives variable overrides and does regex replacement in the CSS file (`--name: oldvalue;` -> `--name: newvalue;`). Content changes are string-replaced across all files in the configured source directories.

## Entry Points

| Import | Description |
|--------|-------------|
| `@agora-build/chisel-dev` | Client: `mountPanel()`, `DevPanel`, utilities |
| `@agora-build/chisel-dev/middleware` | Server: `chiselMiddleware()` |
| `@agora-build/chisel-dev/react` | React: `<ChiselPanel />` |

## License

MIT
