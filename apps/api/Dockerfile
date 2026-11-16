FROM oven/bun:1.4.4 AS install
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
RUN bun install --production --frozen-lockfile --ignore-scripts

FROM oven/bun:1.4.4 AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
COPY --from=install /app/node_modules ./node_modules
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
