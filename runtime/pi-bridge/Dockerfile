FROM node:22-bookworm-slim

LABEL com.mybay.pi.runtime="true" \
  com.mybay.pi.bridge-version="0.1.0-beta" \
  com.mybay.pi.agent-version="0.85.0"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server.mjs ./server.mjs

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
