FROM node:22.17.0
WORKDIR /app
RUN apt-get update && apt-get install -y cmake clang curl

# Install Foundry (for Anvil)
RUN curl -L https://foundry.paradigm.xyz | bash \
    && /root/.foundry/bin/foundryup
ENV PATH="/root/.foundry/bin:${PATH}"

# copy Makefile
COPY Makefile ./

# build and deploy contracts
COPY contracts ./contracts
RUN make build-contracts
# COPY tests ./tests
# RUN make deploy-all

# install graph-cli and deploy subgraph
RUN npm i -g @graphprotocol/graph-cli@latest
# COPY avs-subgraph ./avs-subgraph
# RUN make deploy-subgraph

# Copy package.json and package-lock.json (if it exists)
COPY package.json package-lock.json* ./

# Install dependencies (including vitest)
RUN npm install

# Copy the rest of the application code
COPY . .

# Default command
# CMD ["make", "test"]

CMD ["npx", "tsx", "./tests/integration.test.ts"]
