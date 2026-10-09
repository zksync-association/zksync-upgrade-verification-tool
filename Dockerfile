FROM node:20-slim

LABEL org.opencontainers.image.source=https://github.com/zksync-association/zksync-upgrade-verification-tool

# Configure pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm i -g pnpm@9.7.1

# Setup working dir
RUN mkdir /app
WORKDIR /app

COPY ./turbo.json /app/turbo.json
COPY ./package.json /app/package.json
COPY ./pnpm-lock.yaml /app/pnpm-lock.yaml
COPY ./pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY ./packages/common/package.json /app/packages/common/package.json
COPY ./packages/e2e/package.json /app/packages/e2e/package.json
COPY ./packages/typescript-config/package.json /app/packages/typescript-config/package.json
COPY ./apps/web/package.json /app/apps/web/package.json
COPY ./apps/cli/package.json /app/apps/cli/package.json

RUN pnpm install --prod=false --frozen-lockfile

COPY . .

RUN pnpm run build

# The app's local state (saved settings, the chain cache) lives here; mount a volume to keep it.
RUN install -d -m 0700 -o node -g node /app/apps/web/.cache

ENV SERVER_PORT=3000
ENV SERVER_HOST=0.0.0.0
EXPOSE 3000

WORKDIR /app/apps/web
USER node
# Only L1_RPC_URL is required; see README.md for the optional variables.
CMD ["node", "./server-build/index.js"]
