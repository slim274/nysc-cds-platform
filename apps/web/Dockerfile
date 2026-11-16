FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
RUN bun install --frozen-lockfile
COPY . .
WORKDIR /app/apps/web
ENV NODE_ENV=production
RUN bun run --bun build

FROM oven/bun:1.4.4 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    PROTOCOL_HEADER=x-forwarded-proto \
    HOST_HEADER=x-forwarded-host \
    PORT_HEADER=x-forwarded-port \
    ADDRESS_HEADER=x-forwarded-for \
    XFF_DEPTH=1
COPY --from=build --chown=bun:bun /app/apps/web/build ./build
COPY --from=build --chown=bun:bun /app/apps/web/package.json ./package.json
USER bun
EXPOSE 3000
CMD ["bun", "./build"]
