FROM node:20-slim

LABEL org.opencontainers.image.source=https://github.com/zksync-association/zksync-upgrade-verification-tool

# Configure pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm i -g pnpm

# Setup working dir
RUN mkdir /app
WORKDIR /app

COPY ./turbo.json /app/turbo.json
COPY ./package.json /app/package.json
COPY ./pnpm-lock.yaml /app/pnpm-lock.yaml
COPY ./pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY ./packages/common/package.json /app/packages/common/package.json
COPY ./packages/contracts/package.json /app/packages/contracts/package.json
COPY ./packages/e2e/package.json /app/packages/e2e/package.json
COPY ./packages/ethereum-reports/package.json /app/packages/ethereum-reports/package.json
COPY ./packages/typescript-config/package.json /app/packages/typescript-config/package.json
COPY ./apps/web/package.json /app/apps/web/package.json
COPY ./apps/cli/package.json /app/apps/cli/package.json

RUN pnpm install --prod=false --frozen-lockfile

COPY . .

RUN pnpm run build

ENV SERVER_PORT=3000
EXPOSE 3000

WORKDIR /app/apps/web
CMD ["node", "./server-build/index.js"]
