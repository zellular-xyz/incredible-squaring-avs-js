############################# HELP MESSAGE #############################
.PHONY: $(MAKECMDGOALS)

___BUILD___: ## 

rebuild:
	COMPOSE_BAKE=true docker compose build --no-cache

___TESTS___: ## 

test:
	pytest -s ./tests/test_integration.py

build-docker:
	docker build -t incredible-squaring-avs-js .

test-docker:
	docker run --rm incredible-squaring-avs-js

test-docker-compose: ## Run tests using docker-compose
	docker-compose run --rm incredible-squaring-avs-js

lint: ## Run linting with flake8
	flake8 . --count --select=E9,F63,F7,F82 --show-source --statistics
	flake8 . --count --exit-zero --max-complexity=10 --max-line-length=127 --statistics

format: ## Format code with black and isort
	black .
	isort .

format-check: ## Check if code is properly formatted
	black --check squaring_operator.py aggregator.py challenger.py cli tests
	isort --check-only squaring_operator.py aggregator.py challenger.py cli tests

mypy: ## Run type checking with mypy
	mypy .

check-all: format-check lint mypy ## Run all code quality checks

___CONTRACTS___: ## 

build-contracts: ## builds all contracts
	cd contracts && forge build

deploy-eigenlayer: ## Deploy eigenlayer
	./tests/anvil/deploy-eigenlayer.sh

deploy-avs: ## Deploy avs
	./tests/anvil/deploy-avs.sh

create-quorum:
	./tests/anvil/create-quorum.sh

modify-allocations:
	./tests/anvil/modify-allocations.sh

uam-permissions:
	./tests/anvil/uam-permissions.sh

set-allocation-delay:
	./tests/anvil/set-allocation-delay.sh

set-allocation-delay-and-modify-allocation: set-allocation-delay modify-allocations

deploy-all: deploy-eigenlayer deploy-avs uam-permissions create-quorum

start-anvil-with-state:
	anvil --load-state tests/anvil/avs-and-eigenlayer-deployed-anvil-state/state.json --print-traces -vvvvv

start-graph-node:
	docker compose -f avs-subgraph/docker-compose.yml  up

deploy-subgraph:
	cd avs-subgraph && \
	graph codegen && \
	graph build && \
	graph create --node http://localhost:8020/ avs-subgraph && \
	graph deploy -l v1 --node http://localhost:8020/ --ipfs http://localhost:5001 avs-subgraph


___PYTHON_SETUP___: ## 

setup-and-activate: ## Create venv, activate it, and install dependencies
	python3 -m venv .venv && \
	bash -c "source .venv/bin/activate && \
	pip install . && \
	echo 'Virtual environment created, activated, and dependencies installed.' && \
	echo 'For future sessions, activate with: source .venv/bin/activate'"

__CLI__: ## 

cli-setup-operator: send-fund cli-register-operator-with-eigenlayer cli-deposit-into-mocktoken-strategy cli-register-operator-with-avs ## registers operator with eigenlayer and avs

cli-register-operator-with-eigenlayer: ## registers operator with delegationManager
	./.venv/bin/python -m cli.main register-with-eigenlayer

cli-deposit-into-mocktoken-strategy: ## 
	./.venv/bin/python -m cli.main deposit

cli-register-operator-with-avs: ## 
	./.venv/bin/python -m cli.main register-with-avs

cli-deregister-operator-with-avs: ## 
	./.venv/bin/python -m cli.main deregister-from-avs

send-fund: ## sends fund to the operator saved in tests/keys/test.ecdsa.key.json
	cast send 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --value 10ether --private-key 0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6

____OFFCHAIN_SOFTWARE___: ## 
start-aggregator: ## 
	LOG_LEVEL=debug npx tsx aggregator.ts

start-operator: ## 
	LOG_LEVEL=debug npx tsx operator.ts

start-challenger: ## 
	LOG_LEVEL=debug npx tsx challenger.ts

__REWARDS__: ##

SENDER_ADDR=0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266

TOKEN_ADDRESS=$(shell jq -r '.addresses.token' contracts/script/deployments/incredible-squaring/31337.json)

create-avs-distributions-root:
	export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 && \
	cd contracts && \
		forge script script/SetupDistributions.s.sol --rpc-url http://localhost:8545 \
			--broadcast --sig "runAVSRewards()" -v --sender ${SENDER_ADDR}

create-operator-directed-distributions-root:
	export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 && \
	cd contracts && \
		forge script script/SetupDistributions.s.sol --rpc-url http://localhost:8545 \
			--broadcast --sig "runOperatorDirected()" -v --sender ${SENDER_ADDR}

claim-distributions:
	export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 && \
	cd contracts && \
		forge script script/SetupDistributions.s.sol --rpc-url http://localhost:8545 \
			--broadcast --sig "executeProcessClaim()" -v --sender ${SENDER_ADDR}

get-deployed-token-address:
	@echo "Deployed token Address: $(TOKEN_ADDRESS)"

claimer-account-token-balance:
	cast balance --erc20 $(TOKEN_ADDRESS) 0x0000000000000000000000000000000000000001
