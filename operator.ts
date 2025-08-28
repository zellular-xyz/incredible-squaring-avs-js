import * as fs from 'fs';
import axios from 'axios'
import Web3, { eth as web3Eth } from 'web3';
import { AbiItem, keccak256 } from 'web3-utils';
import pino from 'pino';
import { } from "eigensdk"
import { KeyPair, Signature, init as blsInit } from "eigensdk/crypto/bls/attestation"
import { BuildAllConfig, Clients, buildAll } from 'eigensdk/chainio/clients/builder';
import {
    Bytes,
    Operator, OperatorId, OperatorSetParams,
    StrategyParams, Uint256, Uint32, Uint64, Uint96
} from 'eigensdk/types/general';
import { timeout, yamlLoad } from './utils'
import { abiEncodeData, decodeTxLog, g1PointToArgs, jsonEncode } from 'eigensdk/utils/helpers';
import * as SquaringABIs from './abis/index'


const logger = pino({
    level: process.env.LOG_LEVEL || 'info', // Set log level here
    transport: {
        target: 'pino-pretty',
        options: { 
            colorize: true,
            sync: true // Ensure pino-pretty is synchronous
        }
    },
});

const ID_ZERO = `0x0000000000000000000000000000000000000000000000000000000000000000`

interface Config {
    ethRpcUrl: string;
    operatorAddress: string;
    aggregatorServerIpPortAddress: string;
    ecdsaPrivateKeyStorePath: string;
    blsPrivateKeyStorePath: string;
    avsRegistryCoordinatorAddress: string;
    operatorStateRetrieverAddress: string;
    rewardsCoordinatorAddress: string;
    permissionControllerAddress: string;
    serviceManagerAddress: string;
    allocationManagerAddress: string;
    delegationManagerAddress: string;
    tokenStrategyAddr: string;
    timesFailing?: string;
    registerOperatorOnStartup?: string;
}

interface TaskResponse {
    referenceTaskIndex: number;
    numberSquared: number;
}

interface SignedResponse {
    taskResponse: TaskResponse;
    blsSignature: any; // Adjust based on eigensdk-ts KeyPair.toJson() type
    operatorId: string | null;
}

type NewTaskCreatedEvent = {
    taskIndex: number,
    task: {
        numberToBeSquared: number,
        taskCreatedBlock: number,
        quorumNumbers: Bytes,
        quorumThresholdPercentage: number
    }
}

export class SquaringOperator {
    private config: Config;
    private timesFailing: number;
    private blsKeyPair?: KeyPair;
    private operatorEcdsaPrivateKey?: string;
    private operatorAddress?: string;
    private clients?: Clients; // Replace with proper eigensdk-ts type
    private taskManager: any; // Web3.js contract type
    private web3?: Web3;
    private operatorId?: string;
    private stopFlag: boolean;

    constructor(config: Config) {
        this.config = config;
        this.timesFailing = parseInt(config.timesFailing || '0', 10);
        this.stopFlag = false;
    }

    async init() {
        this.web3 = new Web3(this.config.ethRpcUrl);

        await this.loadBlsKey();
        await this.loadEcdsaKey();
        await this.loadClients();
        await this.loadTaskManager();

        await this.loadOperatorId();

        if (this.config.registerOperatorOnStartup && this.operatorId == ID_ZERO) {
            await this.registerOperatorOnStartup();
            await this.loadOperatorId();
        }

        logger.debug('Operator initialized successfully');
    }

    private async loadBlsKey() {
        const blsKeyPassword = process.env.OPERATOR_BLS_KEY_PASSWORD || '';
        this.blsKeyPair = await KeyPair.readFromFile(this.config.blsPrivateKeyStorePath, blsKeyPassword);
        logger.debug(`BLS PubG1: ${this.blsKeyPair.pubG1.getStr()} PubG2: ${this.blsKeyPair.pubG2.getStr()}`);
    }

    private async loadEcdsaKey() {
        const ecdsaKeyPassword = process.env.OPERATOR_ECDSA_KEY_PASSWORD || '';
        const keystore = JSON.parse(fs.readFileSync(this.config.ecdsaPrivateKeyStorePath, 'utf8'));
        const account = await this.web3!.eth.accounts.decrypt(keystore, ecdsaKeyPassword);
        this.operatorEcdsaPrivateKey = account.privateKey;
        this.operatorAddress = account.address;
        logger.debug(`Loaded ECDSA key for address: ${this.operatorAddress}`);
    }

    private async loadClients() {
        if (!this.operatorEcdsaPrivateKey) {
            throw new Error('ECDSA private key not loaded');
        }

        const cfg: BuildAllConfig = new BuildAllConfig({
            ethHttpUrl: this.config.ethRpcUrl,
            avsName: 'incredible-squaring',
            registryCoordinatorAddr: this.config.avsRegistryCoordinatorAddress,
            operatorStateRetrieverAddr: this.config.operatorStateRetrieverAddress,
            rewardsCoordinatorAddr: this.config.rewardsCoordinatorAddress,
            permissionControllerAddr: this.config.permissionControllerAddress,
            serviceManagerAddr: this.config.serviceManagerAddress,
            allocationManagerAddr: this.config.allocationManagerAddress,
            delegationManagerAddr: this.config.delegationManagerAddress
        });
        this.clients = await buildAll(cfg, this.operatorEcdsaPrivateKey);
        logger.debug('Successfully loaded AVS clients');
    }

    private async loadTaskManager(): Promise<void> {
        if (!this.clients) {
            throw new Error('Clients not loaded');
        }
        if (!this.web3) {
            throw new Error('Web3 instance not loaded');
        }

        const serviceManagerAddress = this.clients.avsRegistryWriter.serviceManagerAddr;
        const serviceManager = new this.web3.eth.Contract(SquaringABIs.SERVICE_MANAGER_ABI, serviceManagerAddress);

        const taskManagerAddress: string = await serviceManager.methods.incredibleSquaringTaskManager().call();
        this.taskManager = new this.web3.eth.Contract(SquaringABIs.TASK_MANAGER_ABI, taskManagerAddress);

        logger.debug(`Task manager loaded at address: ${taskManagerAddress}`);
    }

    private async loadOperatorId(): Promise<void> {
        if (!this.clients) {
            throw new Error('Clients not loaded');
        }

        this.operatorId = await this.clients.avsRegistryReader.getOperatorId(this.config.operatorAddress);
        if (this.operatorId == ID_ZERO)
            logger.info(`Operator not registered`);
        else
            logger.debug(`Loaded operator ID: ${this.operatorId || 'null'}`);
    }

    public async registerOperatorOnStartup(): Promise<void> {
        logger.debug('Registering operator on startup ...');
        await this.registerOperatorWithEigenlayer();
        logger.debug('Registered operator with eigenlayer');
        const amount: Uint256 = 10n ** 21n; // 1000 tokens with 18 decimals
        const strategyAddr = this.config.tokenStrategyAddr;
        await this.depositIntoStrategy(strategyAddr, amount);
        logger.debug(`Deposited ${amount} into strategy ${strategyAddr}`);
        await this.registerForOperatorSets([0n]); // Default to quorum 0
        logger.debug('Registered operator with AVS');
        await this.setAllocationDelay(0n);
        logger.debug('Set allocation delay to 0');
        const strategies = [this.config.tokenStrategyAddr];
        const newMagnitudes = [100000000n];
        await this.modifyAllocations(strategies, newMagnitudes, 0n);
        logger.debug('Modified allocations successfully');
    }

    public decodeNewTaskEvent(log: any, eventAbi: any): NewTaskCreatedEvent {
        const decodedLog: any = decodeTxLog(log, eventAbi);
        logger.debug("processing event ...")
        // convert all BigInts into number to be json serializable.
        return {
            taskIndex: Number(decodedLog.taskIndex),
            task: {
                numberToBeSquared: Number(decodedLog.task.numberToBeSquared),
                taskCreatedBlock: Number(decodedLog.task.taskCreatedBlock),
                quorumNumbers: decodedLog.task.quorumNumbers,
                quorumThresholdPercentage: Number(decodedLog.task.quorumThresholdPercentage),
            }
        };
    }

    public async start(): Promise<void> {
        logger.debug('Starting Operator...');

        if (!this.taskManager) {
            throw new Error('Task manager not loaded');
        }

        logger.debug('Listening for new tasks...');
        const eventABI: any = SquaringABIs.TASK_MANAGER_ABI.find(({ type, name }) => (type == "event" && name == "NewTaskCreated"));
        const eventTopic = this.web3!.eth.abi.encodeEventSignature(eventABI);
        const filter = {
            fromBlock: 'latest',
            address: this.taskManager.options.address,
            topics: [eventTopic] // Approximate topic for NewTaskCreated
        };

        // Use polling instead of subscription for simplicity
        while (!this.stopFlag) {
            try {
                // TODO: check filter correctness
                // @ts-ignore
                const logs = await this.web3!.eth.getPastLogs(filter);
                logger.debug(`${logs.length} logs detected.`)
                for (const log of logs) {
                    logger.debug(`New task created: ${jsonEncode(log)}`);
                    try {
                        logger.debug("decoding event ...")
                        const newTask: any = this.decodeNewTaskEvent(log, eventABI);
                        logger.debug("processing event ...")
                        // convert all BigInts into number to be json serializable.
                        const taskResponse = await this.processTaskEvent(newTask);
                        logger.debug("signing event ...")
                        const signedResponse = this.signTaskResponse(taskResponse);
                        logger.debug("sending event to the aggregator ...")
                        await this.sendSignedTaskResponse(signedResponse);
                        logger.debug("event process done successfully.")
                    } catch (e: any) {
                        logger.error(`Unexpected error handling task: ${e.message}`);
                    }
                }
            } catch (e: any) {
                logger.error(`Error in event processing loop: ${e.message}`);
            }

            await timeout(3000);
        }; // Poll every 3 seconds
    }

    public stop(): void {
        this.stopFlag = true;
    }

    private async processTaskEvent(event: NewTaskCreatedEvent): Promise<TaskResponse> {
        logger.debug('Processing new task', {
            numberToBeSquared: event.task.numberToBeSquared,
            taskIndex: event.taskIndex,
            taskCreatedBlock: event.task.taskCreatedBlock,
            quorumNumbers: event.task.quorumNumbers,
            quorumThresholdPercentage: event.task.quorumThresholdPercentage
        });

        const taskIndex: number = event.taskIndex;
        const numberToBeSquared: number = event.task.numberToBeSquared;
        let numberSquared: number = numberToBeSquared ** 2;

        // Optional: Simulate failures if configured
        if (this.timesFailing > 0) {
            if (Math.random() * 100 < this.timesFailing) {
                numberSquared = 908243203843;
                logger.debug('Operator computed wrong task result');
            }
        }

        return {
            referenceTaskIndex: taskIndex,
            numberSquared
        };
    }

    private signTaskResponse(taskResponse: TaskResponse): SignedResponse {
        if (!this.blsKeyPair) {
            throw new Error('BLS key pair not loaded');
        }
        const encoded = abiEncodeData(['uint32', 'uint256'], [taskResponse.referenceTaskIndex, taskResponse.numberSquared]);
        const hashBytes = keccak256(encoded);
        const signature = this.blsKeyPair.signMessage(hashBytes).toJson();

        logger.debug(`Signature generated, task id: ${taskResponse.referenceTaskIndex}, number squared: ${taskResponse.numberSquared}`);

        return {
            taskResponse,
            blsSignature: signature,
            operatorId: this.operatorId!
        };
    }

    private async sendSignedTaskResponse(signedResponse: SignedResponse): Promise<void> {
        logger.debug('Submitting task response to aggregator');

        if (!this.web3) {
            throw new Error('Web3 instance not loaded');
        }

        const data = {
            taskIndex: signedResponse.taskResponse.referenceTaskIndex,
            numberSquared: signedResponse.taskResponse.numberSquared,
            signature: signedResponse.blsSignature,
            blockNumber: Number(await this.web3.eth.getBlockNumber()),
            operatorId: signedResponse.operatorId ? signedResponse.operatorId : ''
        };

        logger.debug({ signedResponse, data }, "=============================")

        // Wait briefly to ensure the aggregator has processed the task
        await new Promise(resolve => setTimeout(resolve, 3000));

        const url = `http://${this.config.aggregatorServerIpPortAddress}/signature`;
        const response = await axios.post(url, data);
        if (response.status >= 400) {
            throw new Error(`HTTP error: ${response.status}`);
        }
        logger.debug(`Successfully sent task response to aggregator, response: ${response.data}`);
    }

    private async registerOperatorWithEigenlayer(): Promise<void> {
        if (!this.clients) {
            throw new Error('Clients not loaded');
        }

        const operator: Operator = {
            address: this.config.operatorAddress,
            earningsReceiverAddress: this.config.operatorAddress,
            stakerOptOutWindowBlocks: 0n,
            metadataUrl: '',
            allocationDelay: 0n,
            delegationApproverAddress: this.config.operatorAddress,
        };
        await this.clients.elWriter.registerAsOperator(operator);
    }

    private async depositIntoStrategy(strategyAddr: string, amount: Uint256): Promise<void> {
        if (!this.clients) {
            throw new Error('Clients not loaded');
        }
        await this.clients.elWriter.depositErc20IntoStrategy(strategyAddr, amount);
    }

    private async registerForOperatorSets(operatorSetIds: Uint32[]): Promise<void> {
        if (!this.clients) {
            throw new Error('Clients not loaded');
        }

        const request = {
            operatorAddress: this.config.operatorAddress,
            blsKeyPair: this.blsKeyPair!,
            socket: 'operator-socket',
            avsAddress: this.config.serviceManagerAddress,
            operatorSetIds,
        };
        await this.clients.elWriter.registerForOperatorSets(
            this.config.avsRegistryCoordinatorAddress,
            request
        );
    }

    private async deregisterFromOperatorSets(operatorSetIds: Uint32[]): Promise<any> {
        if (!this.clients) {
            throw new Error('Clients not loaded');
        }

        const request = {
            avs: this.config.serviceManagerAddress,
            operatorSetIds
        };
        return await this.clients.elWriter.deregisterFromOperatorSets(
            this.operatorAddress!,
            request
        );
    }

    private async modifyAllocations(strategies: string[], newMagnitudes: Uint64[], operatorSetId: Uint32): Promise<void> {
        if (!this.clients) {
            throw new Error('Clients not loaded');
        }

        const avsServiceManager = this.config.serviceManagerAddress;
        if (!avsServiceManager) {
            logger.error('Service manager address not configured');
            return;
        }

        await this.clients.elWriter.modifyAllocations(
            this.config.operatorAddress,
            avsServiceManager,
            operatorSetId,
            strategies,
            newMagnitudes
        );
    }

    private async setAllocationDelay(delay: Uint32): Promise<void> {
        if (!this.clients) {
            throw new Error('Clients not loaded');
        }
        await this.clients.elWriter.setAllocationDelay(this.config.operatorAddress, delay);
    }

    private async setAppointee(
        accountAddress: string,
        appointeeAddress: string,
        target: string,
        selector: string
    ): Promise<void> {
        if (!this.clients) {
            throw new Error('Clients not loaded');
        }

        await this.clients.elWriter.setPermission({
            accountAddress,
            appointeeAddress,
            target,
            selector
        });
    }

    private async createTotalDelegatedStakeQuorum(
        operatorSetParams: OperatorSetParams,
        minimumStakeRequired: Uint96,
        strategyParams: StrategyParams[]
    ): Promise<any> {
        if (!this.clients) {
            throw new Error('Clients not loaded');
        }

        return await this.clients.avsRegistryWriter.createTotalDelegatedStakeQuorum(
            operatorSetParams,
            minimumStakeRequired,
            strategyParams
        );
    }
}

async function main(): Promise<void> {
    await blsInit()

    const operatorConfig = yamlLoad('./config-files/operator1.yaml') as Config;
    const avsConfig = yamlLoad('./config-files/avs.yaml') as Config;

    const operator = new SquaringOperator({ ...operatorConfig, ...avsConfig });
    await operator.init()

    // process.on('SIGINT', async () => {
    //     logger.info("Terminating operator ...")
    //     operator.stop()
    // });

    await operator.start();
}

// Run directly if invoked as script
if (require.main === module) {
    main()
        .catch(e => console.dir(e, { depth: 6 }))
        .finally(() => {
            process.exit(0)
        })
}
