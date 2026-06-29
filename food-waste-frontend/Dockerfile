FROM node:22-alpine AS deps
WORKDIR /app
COPY ./food-waste-frontend/package*.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app

ARG NEXT_PUBLIC_APP_ENV=production
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_CASHFREE_MODE=production
ARG API_PROXY_TARGET

ENV NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_CASHFREE_MODE=$NEXT_PUBLIC_CASHFREE_MODE
ENV API_PROXY_TARGET=$API_PROXY_TARGET

COPY --from=deps /app/node_modules ./node_modules
COPY ./food-waste-frontend ./
COPY ./shared ../shared

RUN npm run env:validate
RUN npm run build

FROM node:22-alpine AS runner
ARG API_PROXY_TARGET
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV API_PROXY_TARGET=$API_PROXY_TARGET

WORKDIR /app

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
