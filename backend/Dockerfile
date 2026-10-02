FROM node:26.10.0-bookworm-slim AS build

WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/ ./

RUN npm run build


FROM node:26.10.0-bookworm-slim

WORKDIR /app/backend

ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/backend/dist ./dist

USER node

EXPOSE 8080

CMD ["node", "dist/server.js"]
