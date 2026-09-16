FROM node:22-alpine AS build

RUN corepack enable

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY integraciones ./integraciones

RUN pnpm install --frozen-lockfile && pnpm build && pnpm prune --prod


FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY --from=build /app /app

CMD ["node", "apps/api/dist/principal.js"]
