FROM node:20-slim

# Configure pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Setup working dir
RUN mkdir /app
WORKDIR /app
COPY . .

# Install deps and build
RUN pnpm install --prod=false --frozen-lockfile
RUN pnpm run build

# launch the webapp
WORKDIR /app/webapp
CMD ["pnpm", "start"]