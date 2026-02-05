# Production Deployment Files

This directory contains production-specific deployment configuration:

- **`Dockerfile`** - Multi-stage Docker build using mise + pnpm for building, Alpine for runtime
- **`.dockerignore`** - Files to exclude from Docker build context
- **`mise.toml`** - Tool versions for mise (Node.js and pnpm)
- **`DEPLOY.md`** - Deployment instructions and best practices

## Building the Docker image

From the `agent/` directory:

```bash
docker build -f prod/Dockerfile -t crossliquid-agent .
```

The build context is the `agent/` directory, so all paths in the Dockerfile are relative to that.

## Debugging the build: shell into the builder before it fails

When a step fails, you can get a bash shell at the **last successful step** and run the failing command by hand:

1. **Comment out the failing RUN** (and any later RUNs in that stage) in `prod/Dockerfile`. For example, if `RUN pnpm run build` fails, comment it out:
   ```dockerfile
   # RUN pnpm run build
   ```

2. **Build only the builder stage** (from the `agent/` directory):
   ```bash
   docker build -f prod/Dockerfile --target builder -t agent-builder .
   ```

3. **Run a container with bash** (overrides the default command so the container doesn’t exit):
   ```bash
   docker run -it --entrypoint /bin/bash agent-builder
   ```
   You’re now in the builder image at the state right after the last successful RUN.

4. **Run the failing command manually** to see errors and experiment:
   ```bash
   pnpm run build
   # or whatever command was failing
   ```

5. When you’re done, **restore the Dockerfile** (uncomment the RUN) and rebuild as usual.
