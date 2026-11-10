# Build: typecheck, build web, đóng gói API/game/migrator thành JS (scripts/build-server.mjs).
FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/game/package.json apps/game/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/security/package.json packages/security/package.json
RUN npm ci
COPY . .
RUN npm run build

# Runtime backend: chỉ dependency production + JS đã build, không có tsx/TypeScript.
FROM node:26-bookworm-slim AS backend
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/game/package.json apps/game/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/security/package.json packages/security/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist/server ./dist/server
COPY db ./db
USER node
CMD ["node", "dist/server/api.mjs"]

FROM nginx:1.28-alpine AS web
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
