# Switchlink CRM: production image. Everything here is free and open source.
# Switchlink CRM is © 2026 Anyonaz NewTech (proprietary, see LICENSE).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
# The git commit this image is built from (scripts/release.sh passes it); shown in the app and /api/health.
ARG GIT_COMMIT=""
ENV NEXT_TELEMETRY_DISABLED=1 GIT_COMMIT=${GIT_COMMIT}
# No DATABASE_URL here on purpose: the build never connects to the database.
RUN npm run build

# "tools" image: runs migrations, the first-admin script and the demo seed.
FROM deps AS tools
COPY . .
CMD ["npx", "tsx", "scripts/migrate.ts"]

# "backup" image: nightly database + files backup (scripts/backup-run.sh).
FROM postgres:16-alpine AS backup
RUN apk add --no-cache openssl rclone tzdata
COPY scripts/backup-run.sh /usr/local/bin/backup-run.sh
COPY scripts/backup-loop.sh /usr/local/bin/backup-loop.sh
RUN chmod 755 /usr/local/bin/backup-run.sh /usr/local/bin/backup-loop.sh
CMD ["/usr/local/bin/backup-loop.sh"]

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ARG GIT_COMMIT=""
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 STORAGE_DIR=/app/storage GIT_COMMIT=${GIT_COMMIT}
# Statement and spreadsheet readers: Python + xlrd (BSD) + openpyxl (MIT).
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip tini \
 && pip3 install --no-cache-dir --break-system-packages xlrd==2.0.2 openpyxl==3.1.5 \
 && apt-get purge -y python3-pip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 1001 crm && mkdir -p /app/storage && chown crm /app/storage
COPY --from=build --chown=crm /app/.next/standalone ./
COPY --from=build --chown=crm /app/.next/static ./.next/static
COPY --from=build --chown=crm /app/public ./public
COPY --from=build --chown=crm /app/tools ./tools
# The LICENSE is part of the authorship signature check (src/lib/signature-check.ts).
COPY --from=build --chown=crm /app/LICENSE ./LICENSE
USER crm
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
