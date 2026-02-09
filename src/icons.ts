import type { DetectedIcon, IconLibrary } from "./types";

/**
 * Convert kebab-case to PascalCase: "arrow-right" -> "ArrowRight"
 */
export function kebabToPascal(kebab: string): string {
  return kebab
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * From a click target, find the nearest SVG element.
 * Handles clicks on <path>, <circle>, etc. inside an <svg>.
 */
export function findSVGIcon(el: Element): SVGSVGElement | null {
  if (el instanceof SVGSVGElement) return el;
  const svg = el.closest("svg");
  return svg instanceof SVGSVGElement ? svg : null;
}

/**
 * Detect the icon library and name from an SVG element's CSS classes/attributes.
 */
export function detectIcon(svg: SVGSVGElement): DetectedIcon | null {
  // Lucide: <svg class="lucide lucide-zap ...">
  if (svg.classList.contains("lucide")) {
    for (let i = 0; i < svg.classList.length; i++) {
      const cls = svg.classList[i];
      if (cls.startsWith("lucide-") && cls !== "lucide") {
        const iconName = cls.slice("lucide-".length);
        return {
          library: "lucide",
          iconName,
          componentName: kebabToPascal(iconName),
          element: svg,
          importSource: "lucide-react",
        };
      }
    }
  }

  // FontAwesome: <svg class="svg-inline--fa ..." data-icon="house">
  if (svg.classList.contains("svg-inline--fa")) {
    const iconName = svg.getAttribute("data-icon");
    if (iconName) {
      const prefix = svg.getAttribute("data-prefix") || "fas";
      const importMap: Record<string, string> = {
        fas: "@fortawesome/free-solid-svg-icons",
        far: "@fortawesome/free-regular-svg-icons",
        fab: "@fortawesome/free-brands-svg-icons",
      };
      return {
        library: "fontawesome",
        iconName,
        componentName: "fa" + kebabToPascal(iconName),
        element: svg,
        importSource: importMap[prefix] || "@fortawesome/free-solid-svg-icons",
      };
    }
  }

  // Material UI: <svg class="MuiSvgIcon-root ..." data-testid="HomeIcon">
  if (svg.classList.contains("MuiSvgIcon-root")) {
    const testId = svg.getAttribute("data-testid");
    if (testId && testId.endsWith("Icon")) {
      const componentName = testId;
      const iconName = testId.replace(/Icon$/, "");
      return {
        library: "material",
        iconName: iconName.toLowerCase(),
        componentName,
        element: svg,
        importSource: "@mui/icons-material",
      };
    }
  }

  return null;
}
