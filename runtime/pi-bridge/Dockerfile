FROM node:22-bookworm-slim

ARG PI_AGENT_VERSION=0.85.1
LABEL com.mybay.pi.runtime="true" \
  com.mybay.pi.bridge-version="0.1.1-beta" \
  com.mybay.pi.agent-version="${PI_AGENT_VERSION}"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  && if [ "$(node -p "require('./node_modules/@earendil-works/pi-coding-agent/package.json').version")" != "${PI_AGENT_VERSION}" ]; then \
       npm install --omit=dev --ignore-scripts --no-audit --no-fund --save-exact "@earendil-works/pi-coding-agent@${PI_AGENT_VERSION}"; \
     fi
COPY server.mjs ./server.mjs
COPY mybay-a2a-extension.mjs ./mybay-a2a-extension.mjs

RUN mkdir -p /opt/data/workspace /opt/data/pi/sessions /opt/data/pi/runs \
  && chown -R node:node /app /opt/data

ENV NODE_ENV=production \
  PORT=8080 \
  PI_CODING_AGENT_DIR=/opt/data/pi \
  PI_CODING_AGENT_SESSION_DIR=/opt/data/pi/sessions \
  PI_SKIP_VERSION_CHECK=1 \
  PI_TELEMETRY=0

EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
