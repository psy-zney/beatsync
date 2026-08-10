# syntax=docker/dockerfile:1.7

ARG GO_VERSION=1.26
ARG RUST_VERSION=1.90
ARG ALPINE_VERSION=3.22
ARG YTDLP_VERSION=2026.07.04

FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-alpine AS go-builder
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src

COPY apps/server/go.mod apps/server/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY apps/server/cmd ./cmd
COPY apps/server/internal ./internal
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/beatsync-server ./cmd/beatsync

FROM rust:${RUST_VERSION}-alpine AS rust-builder
RUN apk add --no-cache musl-dev
WORKDIR /src

COPY apps/server/yt-rust-extractor/Cargo.toml apps/server/yt-rust-extractor/Cargo.lock ./
COPY apps/server/yt-rust-extractor/src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked \
    && mkdir -p /out \
    && cp target/release/yt-rust-extractor /out/yt-rust-extractor

FROM alpine:${ALPINE_VERSION} AS yt-dlp-downloader
ARG TARGETARCH
ARG YTDLP_VERSION
RUN apk add --no-cache ca-certificates curl
WORKDIR /out
RUN case "$TARGETARCH" in \
      amd64) asset="yt-dlp_musllinux" ;; \
      arm64) asset="yt-dlp_musllinux_aarch64" ;; \
      *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && release_url="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}" \
    && curl --fail --location --retry 3 --proto '=https' --tlsv1.2 \
      --output yt-dlp "${release_url}/${asset}" \
    && curl --fail --location --retry 3 --proto '=https' --tlsv1.2 \
      --output SHA2-256SUMS "${release_url}/SHA2-256SUMS" \
    && expected_hash="$(awk -v target="${asset}" '$2 == target { print $1 }' SHA2-256SUMS)" \
    && test -n "${expected_hash}" \
    && printf '%s  yt-dlp\n' "${expected_hash}" | sha256sum -c - \
    && chmod 0755 yt-dlp \
    && rm SHA2-256SUMS

FROM alpine:${ALPINE_VERSION} AS runtime
LABEL org.opencontainers.image.title="BeatSync backend" \
      org.opencontainers.image.source="https://github.com/psy-zney/beatsync"

RUN apk add --no-cache ca-certificates \
    && addgroup -S -g 10001 beatsync \
    && adduser -S -D -H -u 10001 -G beatsync beatsync \
    && mkdir -p /app/data \
    && chown -R beatsync:beatsync /app

WORKDIR /app
COPY --from=go-builder --chown=10001:10001 /out/beatsync-server ./beatsync-server
COPY --from=rust-builder --chown=10001:10001 /out/yt-rust-extractor ./yt-rust-extractor
COPY --from=yt-dlp-downloader --chown=10001:10001 /out/yt-dlp ./yt-dlp

USER 10001:10001
ENV HOST=0.0.0.0 \
    PORT=1001 \
    GOMEMLIMIT=220MiB \
    GOGC=75 \
    LOCAL_BACKUP_PATH=/app/data/state-backup-latest.json \
    PATH="/app:${PATH}"

EXPOSE 1001
VOLUME ["/app/data"]
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -T 2 -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["/app/beatsync-server"]
