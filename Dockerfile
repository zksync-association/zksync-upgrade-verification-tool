FROM --platform=linux/amd64 node:20-bullseye-slim

# Configure pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm i -g pnpm

# install git (needed to compile system contracts)
RUN apt-get update && apt-get install -y git
RUN apt-get install -y build-essential python3

# Setup working dir
RUN mkdir /app
WORKDIR /app
COPY . .

# Install deps and build
RUN pnpm install --prod=false --frozen-lockfile
RUN pnpm run build

ENV SERVER_PORT=3000
EXPOSE 3000

# launch the webapp
WORKDIR /app/webapp
CMD ["node", "./server-build/index.js"]