# Deploying the agent (Node + better-sqlite3)

## Why not ship `node_modules`?

`better-sqlite3` is a **native addon**: it compiles C++ for the exact OS and Node.js version. Pre-built binaries from another machine (or OS) will not work. The correct approach is to install dependencies **on the server** so the native module is built there.

Build (from the `agent/` directory):

```bash
cd agent
pnpm gen-docker-image
```

Run with the data directory mounted and env from a file:

```bash
docker run -d \
  --name agent \
  -p 3000:3000 \
  -v /path/on/host/agent-data:/app/data \
  --env-file .env \
  crossliquid-agent
```

- `-v /path/on/host/agent-data:/app/data` — use a host directory (or named volume) for the SQLite DB; the container will create `agent.db` there.
- `--env-file .env` — pass RPC URLs, keys, etc. (do not commit `.env`).
