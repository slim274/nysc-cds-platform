FROM oven/bun:1.4.4 AS install
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
RUN bun install --production --frozen-lockfile --ignore-scripts \
    && test -e apps/api/node_modules/hono/package.json \
    && test -e packages/database/node_modules/drizzle-orm/package.json \
    && test -e packages/database/node_modules/postgres/package.json

FROM oven/bun:1.4.4 AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
# Bun's isolated workspace linker creates package-local node_modules links.
# Copy the root store and each runtime workspace's links so imports resolve
# from apps/api and packages/database in the production image.
COPY --from=install /app/node_modules ./node_modules
COPY --from=install /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=install /app/packages/database/node_modules ./packages/database/node_modules
COPY package.json ./package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/src ./apps/api/src
COPY apps/web/package.json ./apps/web/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/database/src ./packages/database/src
RUN mkdir -p /data/corps-member-photos /data/corps-member-documents \
    && chown -R bun:bun /data
USER bun
EXPOSE 3001
CMD ["bun", "run", "--filter", "@nysc/api", "start"]
