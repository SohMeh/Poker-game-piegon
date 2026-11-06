# Flock Poker: one Node process serves the built client, the JSON API and the Socket.IO websockets.
# Rooms live in memory, so run exactly ONE instance (a restart ends every game in progress).

# ---- build: install everything (dev deps included) and produce dist/
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime: production deps + dist only
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
CMD ["node", "dist/server/index.js"]
