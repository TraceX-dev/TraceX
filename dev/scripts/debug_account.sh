#!/bin/bash
set -e

cd ./pods/account
rushx bundle

port=${1:-3000}
echo "Running account on port: ${port}"
export DB_URL="postgresql://postgres:postgres@localhost:5433/postgres"
# DB_URL=postgresql://postgres:example@localhost:5432,
# DB_URL=postgresql://postgres:postgres@tracex.local:5432/postgres,
export SERVER_SECRET="secret"
export REGION_INFO="|America;europe|"
export TRANSACTOR_URL="ws://transactor:3334;ws://localhost:3334,ws://transactor-europe:3335;ws://localhost:3335;europe,"
export ACCOUNTS_URL="http://localhost:${port}"
export ACCOUNT_PORT=${port}
export FRONT_URL="http://localhost:8080"
export STATS_URL="http://tracex.local:4900"
export SES_URL=
export MINIO_ACCESS_KEY="minioadmin"
export MINIO_SECRET_KEY="minioadmin"
export MINIO_ENDPOINT="localhost"
export ADMIN_EMAILS=admin
# DISABLE_SIGNUP=true,
# INIT_SCRIPT_URL=https://raw.githubusercontent.com/hcengineering/init/main/script.yaml,
# INIT_WORKSPACE=onboarding,
node --inspect bundle/bundle.js