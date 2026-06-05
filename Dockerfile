# Stage 1: Builder for TypeScript
FROM oven/bun:1 AS builder
WORKDIR /app

# Install Node.js to run postinstall scripts
RUN apt-get update && apt-get install -y nodejs npm

COPY . .
RUN npm pkg delete scripts.prepare && bun install --ignore-scripts

# Build the server
RUN cd apps/server && bun run build

# Stage 2: Builder for Rust Extractor
FROM rust:slim AS rust-builder
WORKDIR /app
COPY apps/server/yt-rust-extractor ./yt-rust-extractor
RUN cd yt-rust-extractor && cargo build --release

# Stage 3: Runner
FROM oven/bun:1-slim AS runner
WORKDIR /app

# We need python3 for some yt-dlp fallback, and ffmpeg for audio processing if needed
# We also need nodejs because yt-dlp requires a JS runtime to bypass YouTube bot protections
RUN apt-get update && apt-get install -y python3 ffmpeg curl nodejs && rm -rf /var/lib/apt/lists/*

# Install yt-dlp globally
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json

# Copy rust extractor
COPY --from=rust-builder /app/yt-rust-extractor/target/release/yt-rust-extractor ./apps/server/yt-rust-extractor/target/release/yt-rust-extractor

WORKDIR /app/apps/server

EXPOSE 8080
ENV NODE_ENV=production

CMD ["bun", "run", "dist/index.js"]