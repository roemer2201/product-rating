# syntax=docker/dockerfile:1
#
# product-rating - image for API and web client in one process.
#
# Built in two stages: the first one installs every dependency and builds both
# workspaces, the second one keeps only what is needed to run. The build
# context is the repository root:
#
#   docker build -f docker/Dockerfile -t product-rating .
#
# For both architectures (a NAS or a Raspberry Pi is arm64, see README 7.1):
#
#   docker buildx build --platform linux/amd64,linux/arm64 -f docker/Dockerfile .

# ---------------------------------------------------------------------------
# Stage 1: build
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

# better-sqlite3 and sharp ship prebuilt binaries for glibc on amd64 and arm64.
# The toolchain is installed anyway, because without it a missing prebuild ends
# in a build error instead of a compile - and it stays in this stage.
RUN apt-get update \
    && apt-get install --no-install-recommends --yes python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Manifests first: as long as they do not change, the install layer is reused
# even though the sources below it did change.
COPY package.json package-lock.json .npmrc ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/

RUN npm ci

COPY . .

# Server bundle including the SQL migrations, plus the web client with its
# service worker.
RUN npm run build

# Leaves exactly the dependencies the runtime needs behind, so the stage below
# can take node_modules over as it is. The lock file stays the authority: no
# second install happens here.
#
# The workspace links are removed afterwards: npm keeps them as symlinks into
# the source tree, which does not exist in the runtime stage. Nothing needs
# them there - the shared workspace is bundled into the server bundle.
RUN npm prune --omit=dev \
    && rm -rf node_modules/@product-rating

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="product-rating" \
      org.opencontainers.image.description="Self-hostable web app for recording products by EAN with a photo and a rating" \
      org.opencontainers.image.source="https://github.com/roemer2201/product-rating" \
      org.opencontainers.image.licenses="UNLICENSED"

ENV NODE_ENV=production
# Where the health check looks; the port has to match server.port of the
# configuration.
ENV PRODUCT_RATING_HEALTH_URL=http://127.0.0.1:8080/healthz

WORKDIR /app

# The unprivileged user "node" comes with the base image (uid 1000). Nothing in
# the application needs root: the data lives in the volume, the configuration is
# read only.
COPY --from=build --chown=root:root /src/node_modules ./node_modules
COPY --from=build --chown=root:root /src/server/dist ./server/dist
# The bundle is ESM; without a package.json declaring "type": "module" next to
# it, node would read the .js files as CommonJS and refuse the first import.
COPY --from=build --chown=root:root /src/server/package.json ./server/package.json
COPY --from=build --chown=root:root /src/web/dist ./web
COPY --chown=root:root docker/config.container.toml /etc/product-rating/config.toml
COPY --chown=root:root docker/entrypoint.sh /usr/local/bin/product-rating-entrypoint
RUN chmod 0755 /usr/local/bin/product-rating-entrypoint

# The volume of the data. Created with the ownership the container user needs:
# docker copies mode and owner into a fresh named volume, so no start-up as
# root is required to fix them. A bind mount from the host keeps the ownership
# of the host and has to be given to uid 1000 there (see docker-compose.yml).
RUN install -d -o node -g node -m 0750 /data /data/db /data/uploads /data/tmp

USER node

EXPOSE 8080
VOLUME ["/data"]

# The server answers /healthz once the database is open, which is exactly the
# point from which it is usable. The start period covers the migrations.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch(process.env.PRODUCT_RATING_HEALTH_URL).then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

# Arguments of "docker run" are passed to the server, for example
# "--log-level debug".
ENTRYPOINT ["/usr/local/bin/product-rating-entrypoint"]
CMD []
