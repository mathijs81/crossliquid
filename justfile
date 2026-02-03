default:
    just --list

push:
    cd web && pnpm build
    # Run the rsync with vars from .env:
    /bin/bash -c 'source .env && rsync -avz --delete web/build/. $SERVER_USER@$SERVER_HOST:$SERVER_PATH'
