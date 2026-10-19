FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    && rm -rf /var/lib/apt/lists/*

# Amazon RDS certificate authorities, so the TLS connection to RDS PostgreSQL is verified
# (used when DB_SSL=true). Harmless when running elsewhere.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem

WORKDIR /app
COPY package*.json ./
# Skip Playwright's own browser download; both engines use the system Chromium.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --omit=dev
COPY . .

ENV HEADLESS=true
ENV CHROME_BIN=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium
EXPOSE 3000
# Run as the unprivileged "node" user that ships with the base image.
USER node
CMD ["node", "server.js"]
