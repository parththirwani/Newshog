# Render CLI's docker service creation path expects a Dockerfile at the repo
# root. Keep this in sync with apps/worker/Dockerfile.
FROM oven/bun:1.3.10

WORKDIR /app

ARG DATABASE_URL=postgresql://newshog:newshog@postgres:5432/newshog
ENV DATABASE_URL=$DATABASE_URL
ARG DIRECT_URL=postgresql://newshog:newshog@postgres:5432/newshog
ENV DIRECT_URL=$DIRECT_URL

COPY . .

RUN bun install --frozen-lockfile

CMD ["bun", "run", "apps/worker/src/index.ts"]
