# syntax=docker/dockerfile:1
#
# Krewsys frontend (Next.js standalone output).
#
# Rewrites and NEXT_PUBLIC_* values are baked in at BUILD time, so pass them as build args:
#   docker build --build-arg BLAZEFLOW_API_URL=http://web:8000 \
#                --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID=... -t blazeflow-frontend frontend

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG BLAZEFLOW_API_URL=http://web:8000
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
# Public marketing site URL (canonical links, sitemap.xml, Open Graph). Empty = siteConfig default.
ARG NEXT_PUBLIC_SITE_URL=
ENV BLAZEFLOW_API_URL=${BLAZEFLOW_API_URL} \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_CLIENT_ID} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/sign-in').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
