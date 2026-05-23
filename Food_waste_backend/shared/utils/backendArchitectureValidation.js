const fs = require("fs");
const path = require("path");

const JS_FILE = /\.js$/;
const ROUTE_FILE = /\.routes\.js$/;
const ROUTER_METHODS = new Set(["get", "post", "put", "patch", "delete", "use"]);
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function location(rootDir, filePath, line) {
  return `${toPosix(path.relative(rootDir, filePath))}:${line}`;
}

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function stripComments(source) {
  let output = "";
  let state = "code";
  let quote = null;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (state === "lineComment") {
      if (char === "\n") {
        output += char;
        state = "code";
      } else {
        output += " ";
      }
      continue;
    }

    if (state === "blockComment") {
      if (char === "*" && next === "/") {
        output += "  ";
        i += 1;
        state = "code";
      } else {
        output += char === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (state === "string") {
      output += char;
      if (char === "\\") {
        output += next || "";
        i += 1;
      } else if (char === quote) {
        state = "code";
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      output += "  ";
      i += 1;
      state = "lineComment";
      continue;
    }

    if (char === "/" && next === "*") {
      output += "  ";
      i += 1;
      state = "blockComment";
      continue;
    }

    if (char === "'" || char === "\"" || char === "`") {
      state = "string";
      quote = char;
    }

    output += char;
  }

  return output;
}

function lineNumber(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

function walkJsFiles(rootDir, relativeDirs) {
  const files = [];

  function walk(currentDir) {
    if (!fs.existsSync(currentDir)) return;

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;

      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile() && JS_FILE.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  for (const relativeDir of relativeDirs) {
    walk(path.join(rootDir, relativeDir));
  }

  return files.sort();
}

function findMatchingParen(source, openIndex) {
  let depth = 0;
  let state = "code";
  let quote = null;

  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (state === "string") {
      if (char === "\\") {
        i += 1;
      } else if (char === quote) {
        state = "code";
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === "\"" || char === "`") {
      state = "string";
      quote = char;
      continue;
    }

    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0) return i;

    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
    }
  }

  return -1;
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let state = "code";
  let quote = null;

  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];

    if (state === "string") {
      if (char === "\\") {
        i += 1;
      } else if (char === quote) {
        state = "code";
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === "\"" || char === "`") {
      state = "string";
      quote = char;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return i;
  }

  return -1;
}

function splitTopLevelArguments(argsSource) {
  const args = [];
  let current = "";
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let state = "code";
  let quote = null;

  for (let i = 0; i < argsSource.length; i += 1) {
    const char = argsSource[i];

    if (state === "string") {
      current += char;
      if (char === "\\") {
        current += argsSource[i + 1] || "";
        i += 1;
      } else if (char === quote) {
        state = "code";
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === "\"" || char === "`") {
      state = "string";
      quote = char;
      current += char;
      continue;
    }

    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (char === "{") braceDepth += 1;
    if (char === "}") braceDepth -= 1;
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth -= 1;

    if (
      char === "," &&
      parenDepth === 0 &&
      braceDepth === 0 &&
      bracketDepth === 0
    ) {
      args.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) args.push(current.trim());
  return args;
}

function resolveRequire(currentFile, requiredPath) {
  if (!requiredPath.startsWith(".")) return null;

  const withExtension = requiredPath.endsWith(".js")
    ? requiredPath
    : `${requiredPath}.js`;
  return path.resolve(path.dirname(currentFile), withExtension);
}

function extractStringLiteral(value) {
  const match = value.match(/^["'`]([^"'`]+)["'`]$/);
  return match ? match[1] : null;
}

function addIssue(report, severity, message, meta = {}) {
  report[severity].push({ message, ...meta });
}

function recordName(seen, name, at, duplicates) {
  if (!seen.has(name)) {
    seen.set(name, at);
    return;
  }

  duplicates.push({
    name,
    first: seen.get(name),
    duplicate: at,
  });
}

function extractModuleExportsObjectKeys(source, assignmentIndex) {
  const openBrace = source.indexOf("{", assignmentIndex);
  if (openBrace === -1) return [];

  const closeBrace = findMatchingBrace(source, openBrace);
  if (closeBrace === -1) return [];

  const body = source.slice(openBrace + 1, closeBrace);
  const keys = [];
  const properties = splitTopLevelArguments(body);

  for (const property of properties) {
    const match = property.match(/^\s*([A-Za-z_$][\w$]*)\s*(?::|$)/);
    if (match) {
      keys.push({
        name: match[1],
        lineOffset: lineNumber(body, body.indexOf(property)),
      });
    }
  }

  return keys;
}

function isControllerImport(rootDir, filePath) {
  if (!filePath) return false;

  const relative = toPosix(path.relative(rootDir, filePath));
  return (
    relative.startsWith("controllers/") ||
    relative === "admin/admin.controller.js"
  );
}

function collectExports(rootDir, filePath, source, report) {
  const cleanSource = stripComments(source);
  const exportNames = new Map();
  const duplicateExports = [];
  const moduleExportAssignments = [];

  for (const match of cleanSource.matchAll(/\bexports\.([A-Za-z_$][\w$]*)\s*=/g)) {
    recordName(
      exportNames,
      match[1],
      location(rootDir, filePath, lineNumber(cleanSource, match.index)),
      duplicateExports,
    );
  }

  for (const match of cleanSource.matchAll(/\bmodule\.exports\.([A-Za-z_$][\w$]*)\s*=/g)) {
    recordName(
      exportNames,
      match[1],
      location(rootDir, filePath, lineNumber(cleanSource, match.index)),
      duplicateExports,
    );
  }

  for (const match of cleanSource.matchAll(/\bmodule\.exports\s*=/g)) {
    const at = location(rootDir, filePath, lineNumber(cleanSource, match.index));
    moduleExportAssignments.push(at);

    for (const key of extractModuleExportsObjectKeys(cleanSource, match.index)) {
      recordName(
        exportNames,
        key.name,
        location(rootDir, filePath, lineNumber(cleanSource, match.index) + key.lineOffset - 1),
        duplicateExports,
      );
    }
  }

  for (const duplicate of duplicateExports) {
    addIssue(
      report,
      "errors",
      `Duplicate export "${duplicate.name}" overwrites an existing handler.`,
      duplicate,
    );
  }

  if (moduleExportAssignments.length > 1) {
    addIssue(report, "errors", "Multiple module.exports assignments can shadow exports.", {
      file: toPosix(path.relative(rootDir, filePath)),
      assignments: moduleExportAssignments,
    });
  }

  return new Set(exportNames.keys());
}

function collectLocalFunctionNames(rootDir, filePath, source, report) {
  const cleanSource = stripComments(source);
  const seen = new Map();
  const duplicates = [];
  const patterns = [
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of cleanSource.matchAll(pattern)) {
      recordName(
        seen,
        match[1],
        location(rootDir, filePath, lineNumber(cleanSource, match.index)),
        duplicates,
      );
    }
  }

  for (const duplicate of duplicates) {
    addIssue(report, "errors", `Duplicate local function "${duplicate.name}" shadows an earlier definition.`, duplicate);
  }
}

function collectRouteImports(filePath, source) {
  const imports = new Map();
  const cleanSource = stripComments(source);

  for (const match of cleanSource.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*require\(["']([^"']+)["']\)/g)) {
    imports.set(match[1], {
      type: "namespace",
      filePath: resolveRequire(filePath, match[2]),
    });
  }

  for (const match of cleanSource.matchAll(/\bconst\s+\{([^}]+)\}\s*=\s*require\(["']([^"']+)["']\)/g)) {
    const resolved = resolveRequire(filePath, match[2]);
    for (const rawName of match[1].split(",")) {
      const parts = rawName.trim().split(/\s+as\s+|:/).map((part) => part.trim());
      const exportName = parts[0];
      const localName = parts[parts.length - 1] || exportName;
      if (exportName) {
        imports.set(localName, {
          type: "named",
          exportName,
          filePath: resolved,
        });
      }
    }
  }

  return imports;
}

function extractHandlerReferences(args) {
  const refs = [];

  for (const arg of args.slice(1)) {
    for (const match of arg.matchAll(/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\b/g)) {
      refs.push({
        type: "namespace",
        localName: match[1],
        exportName: match[2],
      });
    }

    const standalone = arg.match(/^([A-Za-z_$][\w$]*)$/);
    if (standalone) {
      refs.push({
        type: "named",
        localName: standalone[1],
      });
    }
  }

  return refs;
}

function collectRouteRegistrations(rootDir, filePath, source) {
  const cleanSource = stripComments(source);
  const registrations = [];

  for (const match of cleanSource.matchAll(/\brouter\.(get|post|put|patch|delete|use)\s*\(/g)) {
    const method = match[1];
    if (!ROUTER_METHODS.has(method)) continue;

    const openIndex = cleanSource.indexOf("(", match.index);
    const closeIndex = findMatchingParen(cleanSource, openIndex);
    if (closeIndex === -1) continue;

    const args = splitTopLevelArguments(cleanSource.slice(openIndex + 1, closeIndex));
    const routePath = extractStringLiteral(args[0] || "");
    if (!routePath) continue;

    registrations.push({
      method,
      path: routePath,
      filePath,
      line: lineNumber(cleanSource, match.index),
      handlers: extractHandlerReferences(args),
    });
  }

  return registrations.map((registration) => ({
    ...registration,
    at: location(rootDir, registration.filePath, registration.line),
  }));
}

function normalizePath(routePath) {
  if (!routePath || routePath === "/") return "/";
  return `/${routePath.replace(/^\/+|\/+$/g, "")}`;
}

function joinRoutePath(basePath, routePath) {
  const base = normalizePath(basePath);
  const route = normalizePath(routePath);
  if (base === "/") return route;
  if (route === "/") return base;
  return `${base}${route}`;
}

function pathSegments(routePath) {
  return normalizePath(routePath)
    .split("/")
    .filter(Boolean);
}

function routeShadows(earlierPath, laterPath) {
  const earlier = pathSegments(earlierPath);
  const later = pathSegments(laterPath);
  if (earlier.length !== later.length) return false;

  let hasParamMatch = false;

  for (let i = 0; i < earlier.length; i += 1) {
    if (earlier[i] === later[i]) continue;
    if (earlier[i].startsWith(":") && !later[i].startsWith(":")) {
      hasParamMatch = true;
      continue;
    }
    return false;
  }

  return hasParamMatch;
}

function validateRouteFile(rootDir, filePath, source, controllerExports, report) {
  const imports = collectRouteImports(filePath, source);
  const routes = collectRouteRegistrations(rootDir, filePath, source);
  const seen = new Map();

  for (const route of routes) {
    const key = `${route.method.toUpperCase()} ${route.path}`;
    if (seen.has(key)) {
      addIssue(report, "errors", `Duplicate route registration ${key}.`, {
        first: seen.get(key).at,
        duplicate: route.at,
      });
    } else {
      seen.set(key, route);
    }

    for (const previous of seen.values()) {
      if (previous === route || previous.method !== route.method) continue;
      if (routeShadows(previous.path, route.path)) {
        addIssue(report, "errors", `Route ${previous.method.toUpperCase()} ${previous.path} shadows ${route.path}.`, {
          first: previous.at,
          duplicate: route.at,
        });
      }
    }

    for (const handler of route.handlers) {
      const imported = imports.get(handler.localName);
      if (!imported || !imported.filePath) continue;
      if (!isControllerImport(rootDir, imported.filePath)) continue;

      const exportName = handler.type === "named" ? imported.exportName : handler.exportName;
      const exportsForFile = controllerExports.get(imported.filePath);
      if (!exportsForFile || !exportsForFile.has(exportName)) {
        addIssue(report, "errors", `Missing controller binding "${handler.localName}${handler.type === "namespace" ? `.${handler.exportName}` : ""}".`, {
          route: `${route.method.toUpperCase()} ${route.path}`,
          at: route.at,
          importPath: toPosix(path.relative(rootDir, imported.filePath)),
          exportName,
        });
      }
    }
  }

  return routes;
}

function collectApiMounts(rootDir, apiFilePath, source) {
  const cleanSource = stripComments(source);
  const imports = collectRouteImports(apiFilePath, cleanSource);
  const mounts = [];

  for (const match of cleanSource.matchAll(/\bapp\.use\s*\(/g)) {
    const openIndex = cleanSource.indexOf("(", match.index);
    const closeIndex = findMatchingParen(cleanSource, openIndex);
    if (closeIndex === -1) continue;

    const args = splitTopLevelArguments(cleanSource.slice(openIndex + 1, closeIndex));
    const basePath = extractStringLiteral(args[0] || "");
    if (!basePath) continue;

    for (const arg of args.slice(1)) {
      const imported = imports.get(arg);
      if (imported?.filePath) {
        mounts.push({
          basePath,
          routeVar: arg,
          routeFilePath: imported.filePath,
          at: location(rootDir, apiFilePath, lineNumber(cleanSource, match.index)),
        });
      }
    }
  }

  return mounts;
}

function validateMountedRoutes(rootDir, mounts, routesByFile, report) {
  const seenRoutes = new Map();
  const seenMounts = new Map();

  for (const mount of mounts) {
    const mountKey = `${mount.basePath} -> ${toPosix(path.relative(rootDir, mount.routeFilePath))}`;
    if (seenMounts.has(mountKey)) {
      addIssue(report, "errors", `Duplicate route mount ${mountKey}.`, {
        first: seenMounts.get(mountKey),
        duplicate: mount.at,
      });
    } else {
      seenMounts.set(mountKey, mount.at);
    }

    const routes = routesByFile.get(mount.routeFilePath);
    if (!routes) continue;

    for (const route of routes) {
      if (!HTTP_METHODS.has(route.method)) continue;

      const fullPath = joinRoutePath(mount.basePath, route.path);
      const key = `${route.method.toUpperCase()} ${fullPath}`;

      if (seenRoutes.has(key)) {
        addIssue(report, "errors", `Duplicate mounted route ${key}.`, {
          first: seenRoutes.get(key).at,
          duplicate: route.at,
        });
      } else {
        seenRoutes.set(key, route);
      }
    }
  }
}

function formatIssues(issues) {
  return issues
    .map((issue) => {
      const pieces = [issue.message];
      if (issue.at) pieces.push(`at ${issue.at}`);
      if (issue.first) pieces.push(`first ${issue.first}`);
      if (issue.duplicate) pieces.push(`duplicate ${issue.duplicate}`);
      if (issue.route) pieces.push(`route ${issue.route}`);
      if (issue.importPath) pieces.push(`import ${issue.importPath}`);
      if (issue.exportName) pieces.push(`export ${issue.exportName}`);
      return `- ${pieces.join("; ")}`;
    })
    .join("\n");
}

function validateBackendArchitecture(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, "../..");
  const report = {
    errors: [],
    warnings: [],
    summary: {
      filesScanned: 0,
      routesScanned: 0,
      mountedRoutesScanned: 0,
    },
  };

  const files = walkJsFiles(rootDir, [
    "admin",
    "controllers",
    "middlewares",
    "queues",
    "routes",
    "services",
    "shared",
    "workers",
  ]);
  const controllerExports = new Map();
  const routeFiles = [];
  const routesByFile = new Map();

  report.summary.filesScanned = files.length;

  for (const filePath of files) {
    const source = readFile(filePath);
    const exportsForFile = collectExports(rootDir, filePath, source, report);
    collectLocalFunctionNames(rootDir, filePath, source, report);
    controllerExports.set(filePath, exportsForFile);

    if (ROUTE_FILE.test(filePath)) {
      routeFiles.push(filePath);
    }
  }

  for (const routeFile of routeFiles) {
    const routes = validateRouteFile(
      rootDir,
      routeFile,
      readFile(routeFile),
      controllerExports,
      report,
    );
    routesByFile.set(routeFile, routes);
    report.summary.routesScanned += routes.length;
  }

  const apiFilePath = path.join(rootDir, "services", "api", "index.js");
  if (fs.existsSync(apiFilePath)) {
    const mounts = collectApiMounts(rootDir, apiFilePath, readFile(apiFilePath));
    validateMountedRoutes(rootDir, mounts, routesByFile, report);
    report.summary.mountedRoutesScanned = mounts.length;
  }

  return report;
}

function assertBackendArchitecture(options = {}) {
  const report = validateBackendArchitecture(options);
  const logger = options.logger || console;

  if (report.warnings.length) {
    logger.warn("Backend architecture validation warnings", {
      warnings: report.warnings,
      summary: report.summary,
    });
  }

  if (report.errors.length) {
    const message = `Backend architecture validation failed:\n${formatIssues(report.errors)}`;
    const error = new Error(message);
    error.report = report;

    if (logger.error) {
      logger.error("Backend architecture validation failed", {
        errors: report.errors,
        summary: report.summary,
      });
    }

    throw error;
  }

  if (logger.info) {
    logger.info("Backend architecture validation passed", report.summary);
  }

  return report;
}

module.exports = {
  assertBackendArchitecture,
  formatIssues,
  validateBackendArchitecture,
};
