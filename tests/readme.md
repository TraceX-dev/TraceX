# UI Sanity testing using play-wright

## Prepare environment with docker to test final product.

```bash
rush update
rush build
rush bundle
rush docker:build
./prepare.sh
```

### Restore to pure DB

To purge content of sanity workspace following command could be used.

```bash
./restore-workspace.sh
```

## Update the workspace snapshot

Use the same command locally and in CI:

```bash
./update-snapshot.sh [backup-directory]
```

The test stack uses PostgreSQL on port 5433 and Datalake on port 4031.
`tool.sh`, `prepare.sh`, and `restore-workspace.sh` are the shared test commands.
The `*-local.sh` commands target the development stack on ports 5432 and 4030.
`prepare-tests.sh` starts only the infrastructure required by integration tests.

## Prepare local dev environment

```bash
rush update
rush build
rush bundle
./create-local.sh
```

### Restore to pure DB for Local setup

To purge content of sanity workspace following command could be used.

```bash
./restore-local.sh
```

## Running UI tests

```bash
cd ./sanity
rushx uitest # for docker setup
rushx dev-uitest # for dev setup
```

## Debugging UI tests

```bash
cd ./sanity
rushx debug -g test-name # for docker setup
rushx dev-debug -g test-name # for local setup
```

## Capturing new testing scenarios

```bash
rushx codegen # for docker setup
rushx dev-codegen # for local setup
```

## Test authoring.

Please update all navigation with using PlatformURI for CI and dev environment compatible testing.

## Generate Allure

```bash
allure generate allure-results -o allure-report --clean
allure open allure-report
```