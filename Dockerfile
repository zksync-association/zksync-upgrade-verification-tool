FROM node:20-alpine

LABEL org.opencontainers.image.source=https://github.com/zksync-association/zksync-upgrade-verification-tool

# Configure pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm i -g pnpm

# install git (needed to compile system contracts)
RUN apk add git

# Setup working dir
RUN mkdir /app
WORKDIR /app

COPY webapp/package.json webapp/package.json
COPY cli/package.json cli/package.json
COPY e2e/package.json e2e/package.json
COPY package.json package.json
COPY pnpm-lock.yaml pnpm-lock.yaml
COPY pnpm-workspace.yaml pnpm-workspace.yaml

RUN pnpm install --prod=false --frozen-lockfile

COPY . .

RUN pnpm run build

ENV SERVER_PORT=3000
EXPOSE 3000

WORKDIR /app/webapp
CMD ["node", "./server-build/index.js"]
