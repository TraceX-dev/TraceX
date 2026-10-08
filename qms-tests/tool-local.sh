
export MINIO_ACCESS_KEY=minioadmin
export MINIO_SECRET_KEY=minioadmin
export MINIO_ENDPOINT=localhost:9000
export DB_URL=postgresql://postgres:postgres@localhost:5432/postgres
export ACCOUNT_DB_URL=postgresql://postgres:postgres@localhost:5432/postgres
export ACCOUNTS_URL=http://localhost:3000
export TRANSACTOR_URL=ws://localhost:3333
export SERVER_SECRET=secret
export QUEUE_CONFIG=tracex.local:19092

# Restore workspace contents in PostgreSQL/Elasticsearch
node ../dev/tool/bundle/bundle.js $@