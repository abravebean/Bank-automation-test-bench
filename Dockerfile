FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
# Skip Playwright's own browser download; both engines use the system Chromium.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev
COPY . .

ENV HEADLESS=true
ENV CHROME_BIN=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium
EXPOSE 3000
CMD ["node", "server.js"]
