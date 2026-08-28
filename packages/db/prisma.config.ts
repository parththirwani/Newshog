import { defineConfig, env } from "prisma/config";
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
    url: env("DATABASE_URL"),
  },
});