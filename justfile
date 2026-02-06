default:
    just --list

push:
    cd web && pnpm build
    # Run the rsync with vars from .env:
    /bin/bash -c 'source .env && rsync -avz --delete web/build/. $SERVER_USER@$SERVER_HOST:$SERVER_PATH'

push-agent:
    cd agent && pnpm gen-docker-image
    docker save crossliquid-agent:latest > /tmp/crossliquid-agent.img
    /bin/bash -c 'source .env && rsync -avz --progress --inplace /tmp/crossliquid-agent.img $SERVER_USER@$SERVER_HOST:/tmp/'
    rm /tmp/crossliquid-agent.img
    /bin/bash -c 'source .env && ssh $SERVER_USER@$SERVER_HOST "docker load < /tmp/crossliquid-agent.img"'
    /bin/bash -c 'source .env && ssh $SERVER_USER@$SERVER_HOST "supervisorctl restart crossliquid-agent"'

run-agent-locally:
    docker run --rm -t --name crossliquid-agent -p 3000:3000 -v /tmp/cl_data:/app/data --env-file .env crossliquid-agent

run-chain:
    pnpm chain:kill || true
    pnpm chain
    pnpm chain:local_test_setup
    pnpm generate
    agent/init-liquidity.sh