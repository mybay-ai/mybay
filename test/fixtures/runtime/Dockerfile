FROM node:22-bookworm-slim
WORKDIR /fixture
COPY server.mjs ./server.mjs
EXPOSE 9119
USER node
CMD ["node", "server.mjs"]
