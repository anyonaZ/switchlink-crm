# Switchlink CRM: production image. Everything here is free and open source.
# Switchlink CRM is © 2026 Anyonaz NewTech (proprietary, see LICENSE).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# "tools" image: runs migrations, the first-admin script and the demo seed.
FROM deps AS tools
COPY . .
CMD ["npx", "tsx", "scripts/migrate.ts"]

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 STORAGE_DIR=/app/storage
# Statement reader: Python + xlrd (BSD licence).
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip tini \
 && pip3 install --no-cache-dir --break-system-packages xlrd==2.0.2 \
 && apt-get purge -y python3-pip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 1001 crm && mkdir -p /app/storage && chown crm /app/storage
COPY --from=build --chown=crm /app/.next/standalone ./
COPY --from=build --chown=crm /app/.next/static ./.next/static
COPY --from=build --chown=crm /app/public ./public
COPY --from=build --chown=crm /app/tools ./tools
# The LICENSE is part of the authorship signature check (src/lib/signature-check.ts).
COPY --from=build --chown=crm /app/LICENSE ./LICENSE
USER crm
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
