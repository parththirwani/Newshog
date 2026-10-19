import { defineConfig } from "prisma/config";
import { loadEnvFile } from "node:process";

// Prisma 7's config file does NOT auto-load .env (that dependency was dropped).
// Load it explicitly so DATABASE_URL resolves whether the CLI runs from
// packages/db (its own .env), from the repo root (root .env), or via turbo
// (cwd = packages/db). Existing env vars take precedence over the file.
for (const p of [".env", "../.env", "../../.env"]) {
  try {
    loadEnvFile(p);
    break;
  } catch {
    // keep trying the next candidate; a missing file is fine if env is already set
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // `prisma generate` runs during dependency installation on build hosts
    // before runtime secrets are injected. Generation only reads the schema;
    // database access still requires DATABASE_URL/DIRECT_URL at runtime.
    url: process.env.DATABASE_URL ?? "postgresql://newshog:build-only@localhost:5432/newshog",
  },
});
