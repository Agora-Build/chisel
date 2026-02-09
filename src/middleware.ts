import type { MiddlewareOptions } from "./types";

export type { MiddlewareOptions } from "./types";

/** Minimal interface matching Express app or Router — avoids cross-package type conflicts. */
interface AppLike {
  post(path: string, handler: (req: any, res: any) => void): void;
}

const DEFAULTS = {
  cssFile: "src/index.css",
  srcDirs: ["src"],
  extensions: [".tsx", ".ts", ".jsx", ".js", ".vue", ".svelte"],
  commitMessage: "style: update theme variables via chisel",
  apiPrefix: "/api/dev",
} satisfies Required<MiddlewareOptions>;

/**
 * Register chisel dev routes on the given Express app or router.
 *
 * Usage:
 *   import express from "express";
 *   import { chiselMiddleware } from "chisel-dev/middleware";
 *   const app = express();
 *   chiselMiddleware(app, { cssFile: "client/src/index.css" });
 */
export function chiselMiddleware(
  app: AppLike,
  options?: MiddlewareOptions,
): void {
  const opts = { ...DEFAULTS, ...options };

  app.post(`${opts.apiPrefix}/save-styles`, async (req: any, res: any) => {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const { variables, customCSS } = req.body as {
        variables?: Record<string, string>;
        customCSS?: string;
      };

      const cssPath = path.join(process.cwd(), opts.cssFile);
      let css = fs.readFileSync(cssPath, "utf-8");

      if (variables && Object.keys(variables).length > 0) {
        for (const [name, value] of Object.entries(variables)) {
          const varName = name.replace(/^--/, "--");
          const regex = new RegExp(
            `(${varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*)([^;]+)(;)`,
            "g"
          );
          css = css.replace(regex, `$1${value}$3`);
        }
      }

      if (customCSS && customCSS.trim()) {
        css = css.trimEnd() + "\n\n/* Chisel Custom CSS */\n" + customCSS.trim() + "\n";
      }

      fs.writeFileSync(cssPath, css, "utf-8");

      const commit = req.query["commit"] === "true";
      if (commit) {
        const { execSync } = await import("child_process");
        execSync(`git add "${opts.cssFile}"`, { cwd: process.cwd() });
        const result = execSync(
          `git commit -m "${opts.commitMessage}"`,
          { cwd: process.cwd(), encoding: "utf-8" }
        );
        const hashMatch = result.match(/\[[\w-]+\s+([a-f0-9]+)\]/);
        const hash = hashMatch ? hashMatch[1] : "unknown";
        res.json({ success: true, message: `Committed: ${hash}` });
      } else {
        res.json({ success: true, message: `Saved to ${opts.cssFile}` });
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to save styles";
      console.error("chisel save-styles error:", error);
      res.status(500).json({ error: msg });
    }
  });

  app.post(`${opts.apiPrefix}/save-content`, async (req: any, res: any) => {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const { replacements, alsoStageCSS } = req.body as {
        replacements: Array<{ original: string; replacement: string }>;
        alsoStageCSS?: boolean;
      };

      if (!replacements || !Array.isArray(replacements) || replacements.length === 0) {
        res.status(400).json({ error: "No replacements provided" });
        return;
      }

      const findFiles = (dir: string, exts: string[]): string[] => {
        const results: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            results.push(...findFiles(full, exts));
          } else if (exts.some((ext) => entry.name.endsWith(ext))) {
            results.push(full);
          }
        }
        return results;
      };

      const sourceFiles: string[] = [];
      for (const srcDir of opts.srcDirs) {
        const fullDir = path.join(process.cwd(), srcDir);
        if (fs.existsSync(fullDir)) {
          sourceFiles.push(...findFiles(fullDir, opts.extensions));
        }
      }

      const modifiedFiles: string[] = [];

      for (const { original, replacement } of replacements) {
        if (!original || original === replacement) continue;
        for (const filePath of sourceFiles) {
          let content = fs.readFileSync(filePath, "utf-8");
          if (content.includes(original)) {
            content = content.split(original).join(replacement);
            fs.writeFileSync(filePath, content, "utf-8");
            if (!modifiedFiles.includes(filePath)) {
              modifiedFiles.push(filePath);
            }
          }
        }
      }

      if (modifiedFiles.length === 0) {
        res.json({
          success: true,
          message: "No matching text found in source files",
          files: [],
        });
        return;
      }

      const relFiles = modifiedFiles.map((f) => path.relative(process.cwd(), f));

      const commit = req.query["commit"] === "true";
      if (commit) {
        const { execSync } = await import("child_process");
        for (const f of relFiles) {
          execSync(`git add "${f}"`, { cwd: process.cwd() });
        }
        if (alsoStageCSS) {
          execSync(`git add "${opts.cssFile}"`, { cwd: process.cwd() });
        }
        const result = execSync(
          'git commit -m "style: update UI content via chisel"',
          { cwd: process.cwd(), encoding: "utf-8" }
        );
        const hashMatch = result.match(/\[[\w-]+\s+([a-f0-9]+)\]/);
        const hash = hashMatch ? hashMatch[1] : "unknown";
        res.json({
          success: true,
          message: `Committed: ${hash} (${relFiles.length} file${relFiles.length > 1 ? "s" : ""})`,
          files: relFiles,
        });
      } else {
        res.json({
          success: true,
          message: `Saved ${relFiles.length} file${relFiles.length > 1 ? "s" : ""}: ${relFiles.join(", ")}`,
          files: relFiles,
        });
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to save content";
      console.error("chisel save-content error:", error);
      res.status(500).json({ error: msg });
    }
  });

  // ---- Icon save (rewrite imports and usage) ----

  app.post(`${opts.apiPrefix}/save-icons`, async (req: any, res: any) => {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const { changes, alsoStageCSS } = req.body as {
        changes: Array<{
          originalComponent: string;
          replacementComponent: string;
          importSource: string;
          library: string;
        }>;
        alsoStageCSS?: boolean;
      };

      if (!changes || !Array.isArray(changes) || changes.length === 0) {
        res.status(400).json({ error: "No icon changes provided" });
        return;
      }

      const findFiles = (dir: string, exts: string[]): string[] => {
        const results: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            results.push(...findFiles(full, exts));
          } else if (exts.some((ext) => entry.name.endsWith(ext))) {
            results.push(full);
          }
        }
        return results;
      };

      const sourceFiles: string[] = [];
      for (const srcDir of opts.srcDirs) {
        const fullDir = path.join(process.cwd(), srcDir);
        if (fs.existsSync(fullDir)) {
          sourceFiles.push(...findFiles(fullDir, opts.extensions));
        }
      }

      const modifiedFiles: string[] = [];

      for (const { originalComponent, replacementComponent, importSource } of changes) {
        if (!originalComponent || !replacementComponent || originalComponent === replacementComponent) continue;

        for (const filePath of sourceFiles) {
          let content = fs.readFileSync(filePath, "utf-8");
          if (!content.includes(originalComponent)) continue;

          // Rewrite named import: import { ..., Zap, ... } from "lucide-react"
          // Parse specifiers, rename, deduplicate to avoid `import { Rocket, Rocket }`
          const importLineRegex = new RegExp(
            `(import\\s*\\{)([^}]*)(}\\s*from\\s*["']${escapeRegex(importSource)}["'])`,
            "g"
          );
          content = content.replace(importLineRegex, (_match, pre, specifiers, post) => {
            const names = specifiers.split(",").map((s: string) => s.trim()).filter(Boolean);
            const renamed = names.map((n: string) => n === originalComponent ? replacementComponent : n);
            const unique = [...new Set(renamed)];
            return `${pre} ${unique.join(", ")} ${post}`;
          });

          // Rewrite JSX usage: <Zap or <Zap> or <Zap/> or <Zap  (with props)
          const jsxRegex = new RegExp(`<${escapeRegex(originalComponent)}(\\s|\\/>|>)`, "g");
          content = content.replace(jsxRegex, `<${replacementComponent}$1`);

          // Rewrite closing tags: </Zap>
          const closingRegex = new RegExp(`</${escapeRegex(originalComponent)}>`, "g");
          content = content.replace(closingRegex, `</${replacementComponent}>`);

          // Rewrite object references: icon: Zap or icon={Zap}
          const refRegex = new RegExp(`(icon\\s*[:=]\\s*\\{?)\\b${escapeRegex(originalComponent)}\\b`, "g");
          content = content.replace(refRegex, `$1${replacementComponent}`);

          fs.writeFileSync(filePath, content, "utf-8");
          if (!modifiedFiles.includes(filePath)) {
            modifiedFiles.push(filePath);
          }
        }
      }

      if (modifiedFiles.length === 0) {
        res.json({
          success: true,
          message: "No matching icon usage found in source files",
          files: [],
        });
        return;
      }

      const relFiles = modifiedFiles.map((f) => path.relative(process.cwd(), f));

      const commit = req.query["commit"] === "true";
      if (commit) {
        const { execSync } = await import("child_process");
        for (const f of relFiles) {
          execSync(`git add "${f}"`, { cwd: process.cwd() });
        }
        if (alsoStageCSS) {
          execSync(`git add "${opts.cssFile}"`, { cwd: process.cwd() });
        }
        const result = execSync(
          'git commit -m "style: swap icons via chisel"',
          { cwd: process.cwd(), encoding: "utf-8" }
        );
        const hashMatch = result.match(/\[[\w-]+\s+([a-f0-9]+)\]/);
        const hash = hashMatch ? hashMatch[1] : "unknown";
        res.json({
          success: true,
          message: `Committed: ${hash} (${relFiles.length} file${relFiles.length > 1 ? "s" : ""})`,
          files: relFiles,
        });
      } else {
        res.json({
          success: true,
          message: `Saved ${relFiles.length} file${relFiles.length > 1 ? "s" : ""}: ${relFiles.join(", ")}`,
          files: relFiles,
        });
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to save icon changes";
      console.error("chisel save-icons error:", error);
      res.status(500).json({ error: msg });
    }
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
