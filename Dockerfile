# Phosphor — TLTV client
#
# Usage:
#   docker build -t phosphor .
#   docker run -p 3000:80 phosphor

# ── Stage 1: Build ──
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Serve ──
FROM node:22-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
RUN echo '{"type":"module"}' > package.json && npm install sirv
COPY --from=build /app/build ./build
COPY server.js .
RUN chown -R app:app /app

USER app
EXPOSE 80
CMD ["node", "server.js"]
