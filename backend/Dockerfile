# Cloud Run production image.
# Node 24 is the active LTS line; pinning to the LTS major avoids an EOL runtime.
FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24.21.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Run as the unprivileged Node user; Cloud Run already removes host-level
# root capabilities and disables privilege escalation.
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
