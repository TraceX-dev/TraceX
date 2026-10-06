export MODEL_VERSION=$(node ../common/scripts/show_version.js)
export STORAGE_CONFIG="datalake|http://localhost:4030"
export DB_URL=postgresql://postgres:postgres@localhost:5432/postgres
export ACCOUNT_DB_URL=postgresql://postgres:postgres@localhost:5432/postgres
export ACCOUNTS_URL=http://localhost:3000
export TRANSACTOR_URL="ws://tracex.local:3333,ws://tracex.local:3332;;pg"
export ELASTIC_URL=http://localhost:9200
export SERVER_SECRET=secret
export QUEUE_CONFIG=localhost:19092

# Restore workspace contents in PostgreSQL/Elasticsearch
node ../dev/tool/bundle/bundle.js $@