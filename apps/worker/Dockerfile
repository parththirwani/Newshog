# Worker image for the Newshog monorepo (bun workspaces).
#
# Build context is the repo root (all workspace packages are needed). The
# runner starts with apps/worker/src/index.ts, which imports TS sources from
# the @newshog/* workspace packages directly. `.dockerignore` keeps
# node_modules, .env and build artifacts out of the context.
FROM oven/bun:1.3.10

WORKDIR /app

# packages/db's postinstall runs `prisma generate`, and prisma.config.ts
# resolves DATABASE_URL eagerly. A placeholder suffices at build time; the
# compose service overrides it with the real connection string at runtime.
ARG DATABASE_URL=postgresql://newshog:newshog@postgres:5432/newshog
ENV DATABASE_URL=$DATABASE_URL

COPY . .

RUN bun install --frozen-lockfile

CMD ["bun", "run", "apps/worker/src/index.ts"]