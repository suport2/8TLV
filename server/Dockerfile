FROM mcr.microsoft.com/playwright:v1.59.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Instal·lar navegadors Playwright (Chromium)
RUN npx playwright install chromium --with-deps

COPY server.js scraper.js ./
RUN mkdir -p downloads

ENV PORT=3333
ENV NODE_ENV=production

EXPOSE 3333

CMD ["node", "server.js"]
