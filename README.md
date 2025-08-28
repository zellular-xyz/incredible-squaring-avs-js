# Incredible Squaring AVS (Python Edition)

An implementation of the EigenLayer [Incredible Squaring AVS](https://github.com/Layr-Labs/incredible-squaring-avs) in Python. This repository showcases how to use [EigenLayer Python SDK](https://github.com/zellular-xyz/eigensdk-python/) to build an Autonomous Verifiable Service (AVS) in Python.

**⚠️ Warning:** This library is currently in active development. While it can be used for testing and development purposes, please exercise caution when using in production environments.

## Dependencies

[Foundry](https://book.getfoundry.sh/getting-started/installation) is required to build the AVS smart contracts, run a local Anvil chain, deploy contracts to Anvil, and test the Python AVS against the local setup.

Install Foundry:

``` bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Python 3.11+ with pip is required to run the AVS binaries.

Node.js 20+ with npm is required to build and deploy the subgraph to a local Graph Node.

[Docker](https://docs.docker.com/get-docker/)  is required to run the Graph Node and IPFS services using Docker Compose, and to run the Docker-based tests.


## Quick Test (using Docker)

```bash
make build-docker
make test-docker
```

## Install

Create a virtual environment and install Python dependencies using:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install .
```

For development (includes linting, type checking, and formatting tools) install the repository using:

```bash
pip install -e ".[dev]"
```

Install latest version of node and required dependencies for deploying subgraph:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
\. "$HOME/.nvm/nvm.sh"
nvm install 22

cd avs-subgraph
npm i -g @graphprotocol/graph-cli@latest
npm i
```

## Running via make

This simple session illustrates the basic flow of the AVS. The makefile commands are hardcoded for a single operator, but it's however easy to create new operator config files, and start more operators manually (see the actual commands that the makefile calls).

Start anvil in a separate terminal:

```bash
anvil --host 0.0.0.0
```

**Note:** Using `--host 0.0.0.0` enables the subgraph node to connect to the anvil chain.

Build the contracts:

``` bash
make build-contracts
```

Deploy contracts, set UAM permissions, and create a quorum in a single command:

```bash
make deploy-all
```

Start the graph node:

```bash
make start-graph-node
```

**Note:** To start the graph node from scratch, remove the `data` folder inside the `avs-subgraph` using `rm avs-subgraph/data -rf` before starting the subgraph.

Deploy the subgraph:

```bash
make deploy-subgraph
```

Start the aggregator:

```bash
make start-aggregator
```

Register the operator with eigenlayer and incredible-squaring, and then start the process:

```bash
make start-operator
```

By default, the `start-operator` command will also register the operator.
To disable this, set `register_operator_on_startup` to `false` in opeartor `yaml` file in the `config-files`.
The operator can be manually registered by running `make cli-setup-operator`.

The operator will produce an invalid result 10 times out of 100, as it is set in the `times_failing` field of the config.
These failures result in slashing once they're challenged.
To see this in action, start the challenger with:

```bash
make start-challenger
```

## Distribution & Reward Claims

### Equal Distribution:

```bash
make create-avs-distributions-root
make claim-distributions
make claimer-account-token-balance
```

### Operator-Directed Distribution:

```bash
make create-operator-directed-distributions-root
make claim-distributions
make claimer-account-token-balance
```


## Architecture Overview

* **Aggregator:** Publishes new tasks, aggregates signed responses, and submits them on-chain.
* **Operator:** Listens for tasks, computes square, signs result, and submits to aggregator.
* **Challenger:** Verifies correctness of submitted results and challenges if incorrect.

Each task requires computing `x^2` for a given `x`. The aggregator checks that BLS signature quorum thresholds are met before submitting the aggregated result.

## Tests

Run integration tests locally:

```bash
source .venv/bin/activate
pytest tests/ -v
```

## Code Quality

### Linting

Run code linting with flake8:

```bash
make lint
```

### Type Checking

Run type checking with mypy:

```bash
make mypy
```

### Code Formatting

Format code with black and isort:

```bash
make format
```

Check if code is properly formatted:

```bash
make format-check
```

### Run All Checks

Run all code quality checks at once:

```bash
make check-all
```
