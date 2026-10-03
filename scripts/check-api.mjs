// Do the Vercel functions actually start under Node?
//
// Vite and Vercel do not resolve imports the same way. Vite's resolver maps an
// extensionless relative import to a .ts file; Node, running the compiled
// output of a package with "type": "module", does not — it needs the extension
// written out. So a route can serve perfectly in `npm run dev` and answer 500
// in production with ERR_MODULE_NOT_FOUND. That happened, on all eight routes
// at once, and nothing in the build caught it.
//
// This reproduces Vercel's own sequence: transpile only, specifiers untouched,
// then let Node ESM resolve them. It imports each entry point and checks the
// web handlers it is supposed to export.
//
// `npm run typecheck` is the first line of defence (moduleResolution nodenext
// rejects an extensionless relative import outright). This is the second: it
// runs the real resolver.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const out = mkdtempSync(join(tmpdir(), "mosaic-api-"));

// Each route, with the handlers Vercel will look for on it.
const ROUTES = {
  "api/session.js": ["POST"],
  "api/contacts.js": ["GET", "POST"],
  "api/companies.js": ["GET", "POST"],
  "api/notes.js": ["POST"],
  "api/files.js": ["POST"],
  "api/outlook/notes.js": ["GET", "POST", "PATCH"],
  "api/outlook/contacts/index.js": ["POST"],
  "api/outlook/contacts/match.js": ["POST"],
};

try {
  writeFileSync(
    join(out, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "nodenext",
        moduleResolution: "nodenext",
        skipLibCheck: true,
        outDir: join(out, "dist"),
        rootDir: root,
      },
      include: [join(root, "api"), join(root, "functions")],
    }),
  );
  // Transpile only: type errors belong to `npm run typecheck`, and a type
  // error must not hide a resolution error.
  try {
    execFileSync("npx", ["tsc", "-p", join(out, "tsconfig.json")], { cwd: root, stdio: "pipe" });
  } catch {
    // tsc exits non-zero on type errors but still emits, which is what we need.
  }

  const dist = join(out, "dist");
  writeFileSync(join(dist, "package.json"), JSON.stringify({ type: "module" }));
  symlinkSync(join(root, "node_modules"), join(dist, "node_modules"));

  let bad = 0;
  for (const [route, expected] of Object.entries(ROUTES)) {
    try {
      const mod = await import(pathToFileURL(join(dist, route)).href);
      const missing = expected.filter((name) => typeof mod[name] !== "function");
      if (missing.length) {
        bad++;
        console.log(`  ÉCHEC  ${route} — handler absent : ${missing.join(", ")}`);
      } else {
        console.log(`  ok     ${route} — ${expected.join(", ")}`);
      }
    } catch (error) {
      bad++;
      console.log(`  ÉCHEC  ${route} — ${error.code ?? error.name} : ${String(error.message).split("\n")[0]}`);
    }
  }

  const total = Object.keys(ROUTES).length;
  console.log(
    bad
      ? `\n${bad} route(s) sur ${total} ne démarrent pas sous Node. En production, elles répondraient 500.`
      : `\nLes ${total} routes démarrent sous Node et exportent leurs handlers.`,
  );
  process.exit(bad ? 1 : 0);
} finally {
  rmSync(out, { recursive: true, force: true });
}
