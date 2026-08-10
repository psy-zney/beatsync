FROM golang:1.26-alpine AS go-builder
WORKDIR /src/apps/server
COPY apps/server/go.mod apps/server/go.sum ./
RUN go mod download
COPY apps/server/cmd ./cmd
COPY apps/server/internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/beatsync-server ./cmd/beatsync

FROM rust:1.90-alpine AS rust-builder
WORKDIR /src
COPY apps/server/yt-rust-extractor/Cargo.toml apps/server/yt-rust-extractor/Cargo.lock ./
COPY apps/server/yt-rust-extractor/src ./src
RUN cargo build --release --locked && mkdir -p /out && cp target/release/yt-rust-extractor /out

FROM alpine:3.22 AS downloader
RUN apk add --no-cache curl
WORKDIR /out
RUN curl --fail --location --retry 3 --output yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
    && curl --fail --location --retry 3 --output SHA2-256SUMS https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS \
    && grep -E '  yt-dlp_linux$' SHA2-256SUMS | sed 's/yt-dlp_linux$/yt-dlp/' | sha256sum --check --strict \
    && chmod 755 yt-dlp

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && addgroup -S beatsync && adduser -S -G beatsync beatsync
WORKDIR /app
COPY --from=go-builder /out/beatsync-server ./beatsync-server
COPY --from=rust-builder /out/yt-rust-extractor ./yt-rust-extractor
COPY --from=downloader /out/yt-dlp ./yt-dlp
RUN mkdir -p /app/data && chown -R beatsync:beatsync /app
USER beatsync
ENV HOST=0.0.0.0 PORT=1001 GOMEMLIMIT=220MiB GOGC=75 LOCAL_BACKUP_PATH=/app/data/state-backup-latest.json
EXPOSE 1001
VOLUME ["/app/data"]
ENTRYPOINT ["/app/beatsync-server"]
