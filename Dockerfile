FROM rust:1.95-bookworm AS builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY docs ./docs

RUN cargo build --release --locked -p server --bins

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 fmarch

COPY --from=builder /app/target/release/server /usr/local/bin/fmarch-server
COPY --from=builder /app/target/release/fmarch-migrate /usr/local/bin/fmarch-migrate

USER fmarch

EXPOSE 4000

CMD ["fmarch-server"]
