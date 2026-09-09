FROM node:22-bookworm-slim

LABEL com.mybay.codex.runtime="true" \
  com.mybay.codex.bridge-version="0.1.0-experimental.2" \
  com.mybay.codex.agent-version="0.153.4"
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY app-server.mjs runtime.mjs server.mjs release.json ./
RUN mkdir -p /opt/data/workspace /opt/data/codex /opt/data/codex-bridge \
  && chown -R node:node /app /opt/data
ENV NODE_ENV=production PORT=8080 CODEX_HOME=/opt/data/codex CODEX_EXTERNAL_SANDBOX=true
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
