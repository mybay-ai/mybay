# syntax=docker/dockerfile:1

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

ARG VITE_PUBLIC_APP_URL=http://localhost:3000
ARG VITE_MYBAY_PLATFORM_ORIGIN=http://localhost:3000
ENV VITE_PUBLIC_APP_URL=$VITE_PUBLIC_APP_URL \
    VITE_MYBAY_PLATFORM_ORIGIN=$VITE_MYBAY_PLATFORM_ORIGIN

COPY . .
RUN npm run build

FROM node:22-alpine AS production-dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/Dockerfile.feishu ./Dockerfile.feishu

RUN apk add --no-cache curl && rm -rf /usr/local/lib/node_modules/npm && rm -f /usr/local/bin/npm /usr/local/bin/npx && mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null || exit 1

CMD ["node", "dist/server.cjs"]
