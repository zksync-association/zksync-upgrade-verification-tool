FROM node:20-alpine

# Configure pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm i -g pnpm

# install git (needed to compile system contracts)
RUN apk add git

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
CMD ["pnpm", "start"]