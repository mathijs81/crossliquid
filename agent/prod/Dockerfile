# --- STAGE 1: Build (Debian + mise + node + pnpm) ---
FROM ubuntu:24.04 AS builder
WORKDIR /app

# Install build tools for native dependencies (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install mise
RUN install -dm 755 /etc/apt/keyrings && \
    curl -fSs https://mise.jdx.dev/gpg-key.pub | tee /etc/apt/keyrings/mise-archive-keyring.pub > /dev/null && \
    echo "deb [signed-by=/etc/apt/keyrings/mise-archive-keyring.pub arch=amd64] https://mise.jdx.dev/deb stable main" | tee /etc/apt/sources.list.d/mise.list && \
    apt-get update && \
    apt-get install -y mise && \
    rm -rf /var/lib/apt/lists/*

# Copy mise config and initialize tools
COPY prod/mise.prod.toml ./mise.toml
RUN bash -c 'eval "$(mise activate bash)" && mise trust mise.toml && mise install'

# Add mise shims to PATH (root user in Docker)
ENV PATH="/root/.local/share/mise/shims:$PATH"

# Copy only package files first to leverage Docker's layer caching
COPY package*.json ./
RUN npm install

# Copy the rest of your source code
COPY . .

# Run the TypeScript compiler
RUN npm run build

# --- STAGE 2: Production Runtime ---
FROM node:25-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Only copy the compiled JS from the builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Install ONLY production dependencies (no typescript, no @types)
# This will build better-sqlite3 for the runtime environment
RUN npm install --omit=dev

# Empty dir; mount a volume here for the SQLite DB
RUN mkdir -p /app/data && chown -R node:node /app/data

# Run as a non-root user for security
USER node

EXPOSE 3000
ENTRYPOINT ["node"]
CMD ["dist/index.js"]
