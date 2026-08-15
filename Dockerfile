FROM rust:1.95-bookworm@sha256:6258907abe69656e41cd992e0b705cdcfabcbbe3db374f92ed2d47121282d4a1 AS builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY docs ./docs
COPY packs ./packs
COPY programs ./programs

RUN cargo build --release --locked -p server --bins

FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241 AS runtime

LABEL org.opencontainers.image.source="https://github.com/fluffyrabbot/fmarch" \
      org.opencontainers.image.title="fmarch-api"

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 fmarch

COPY --from=builder /app/target/release/server /usr/local/bin/fmarch-server
COPY --from=builder /app/target/release/fmarch-migrate /usr/local/bin/fmarch-migrate
COPY --from=builder /app/target/release/fmarch-schema-gate /usr/local/bin/fmarch-schema-gate
COPY --from=builder /app/target/release/fmarch-event-key-admin /usr/local/bin/fmarch-event-key-admin

USER fmarch

EXPOSE 4000

CMD ["fmarch-server"]
