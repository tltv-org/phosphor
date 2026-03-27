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
RUN npm install -g sirv-cli && \
    addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /app/build ./build
RUN chown -R app:app /app

USER app
EXPOSE 80
CMD ["sirv", "build", "--single", "--host", "0.0.0.0", "--port", "80"]
