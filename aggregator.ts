import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { AbiItem, Contract, Web3, eth as Web3Eth } from 'web3';
import { keccak256 } from 'web3-utils';
import pino from 'pino';
import {
    init as blsInit,
    Signature,
    G1Point, G2Point,
    newZeroG1Point, newZeroG2Point
} from "eigensdk/crypto/bls/attestation"
import { BuildAllConfig, Clients, buildAll } from 'eigensdk/chainio/clients/builder';
import { g1ToTuple, g2ToTuple, timeout, yamlLoad } from './utils'
import { abiEncodeData, decodeTxReceiptLogs } from 'eigensdk/utils/helpers'
// import { AsyncQueue } from './eigensdk/services/bls-aggregation/async-queue';
import * as sdkABIs from "eigensdk/contracts/ABIs";
import * as SquaringABIs from './abis/index'

import express, { Express, Request, Response } from 'express';
import axios from 'axios';
import { BlockNumber, LocalAccount, Uint256, Uint32 } from 'eigensdk/types/general';
import { sendContractCall } from 'eigensdk/chainio/utils';

const TASK_CHALLENGE_WINDOW_BLOCK = 100
const BLOCK_TIME_SECONDS = 12
const AVS_NAME = "incredible-squaring"
const THRESHOLD_PERCENT = 50

// Logger setup
const logger = pino({
    level: process.env.LOG_LEVEL || 'silent', // Set log level here
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            sync: true // Ensure pino-pretty is synchronous
        }
    },
});

// Define specific error types
class AggregatorError extends Error {
    constructor(message?: string) {
        super(message);
        this.name = 'AggregatorError';
    }
}

class TaskNotFoundError extends AggregatorError {
    toString(): string {
        return "400. Task not found";
    }
}

class OperatorNotRegisteredError extends AggregatorError {
    toString(): string {
        return "400. Operator is not registered";
    }
}

class OperatorAlreadyProcessedError extends AggregatorError {
    toString(): string {
        return "400. Operator signature has already been processed";
    }
}

class SignatureVerificationError extends AggregatorError {
    toString(): string {
        return "400. Signature verification failed";
    }
}

class InternalServerError extends AggregatorError {
    toString(): string {
        return "500. Internal server error";
    }
}

type Config = {
    ethRpcUrl: string,
    aggregatorServerIpPortAddress: string,
    ecdsaPrivateKeyStorePath: string,
    avsRegistryCoordinatorAddress: string,
    operatorStateRetrieverAddress: string,
    rewardsCoordinatorAddress: string,
    permissionControllerAddress: string,
    serviceManagerAddress: string,
    allocationManagerAddress: string,
    delegationManagerAddress: string,
}

type Task = {
    numberToBeSquared: number,
    blockNumber: number,
    quorumNumbers: string,
    quorumThresholdPercentage: number,
}

type Operator = {
    id: string,
    operatorId: string,
    socket: string,
    stake: number,
    pubkeyG1_X: string,
    pubkeyG1_Y: string,
    pubkeyG2_X: string[],
    pubkeyG2_Y: string[],
    publicKeyG1?: G1Point,
    publicKeyG2?: G2Point,
}

type SignatureData = {
    taskIndex: number,
    numberSquared: number,
    operatorId: string,
    signature: { x: string, y: string },
    blockNumber: number,
}

type AggregatedResponse = {
    taskIndex: Uint32,
    blockNumber: BlockNumber,
    numberSquared: Uint256,
    numberToBeSquared: Uint256,
    nonSignersPubkeysG1: G1Point[],
    quorumApksG1: G1Point[],
    signersApkG2: G2Point,
    signersAggSigG1: G1Point,
    nonSignerQuorumBitmapIndices: Uint32[],
    quorumApkIndices: Uint32[],
    totalStakeIndices: Uint32[],
    nonSignerStakeIndices: Uint32[][],
}

async function mineBlocks(web3: Web3, numBlocks: number) {
    const result = await web3.provider!.request({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "anvil_mine",
        params: [numBlocks],
    });
    if(!!result.error)
        throw result.error
    return result
}

// export const sigAggQue: AsyncQueue = new AsyncQueue();

export class Aggregator {
    public config: Config;
    public web3: Web3;
    public pkWallet?: LocalAccount;
    public aggregatorEcdsaPrivateKey?: string;
    public aggregatorAddress?: string;
    public clients?: Clients; // Replace with proper type from eigensdk-ts
    public taskManager?: Contract<typeof SquaringABIs.TASK_MANAGER_ABI>; // Web3.js contract type
    public tasks: Record<number, Task> = {};
    public tasksDone: Record<number, boolean> = {};
    public responses: Record<number, Record<string, SignatureData>> = {};
    public app?: Express;
    public subgraphUrl: string = "http://localhost:8000/subgraphs/name/avs-subgraph";
    public stopFlag: boolean = false;

    constructor(config: Config) {
        this.config = config;
        this.web3 = new Web3(this.config.ethRpcUrl);
    }

    async init() {
        this.app = express();
        this.app.use(express.json());
        this.app.post('/signature', this.submitSignature.bind(this));

        await this.loadEcdsaKey();
        await this.loadClients();
        await this.loadTaskManager();
    }

    public async start() {
        logger.debug('Starting aggregator.');

        logger.debug('Starting aggregator rpc server.');
        this.startServer();

        let taskNum = 0;
        while (!this.stopFlag) {
            await timeout(1000)

            logger.debug("Sending new task ...")
            await this.sendNewTask(taskNum++);
            console.log(`Aggregator: task ${taskNum - 1} sent.`)

            await timeout(730_000)
        };
    }

    public stop(): void {
        this.stopFlag = true;
    }

    public async sendNewTask(numToSquare: number): Promise<number | null> {
        logger.debug('Aggregator sending new task', { numberToSquare: numToSquare });

        try {
            const txReceipt = await sendContractCall({
                contract: this.taskManager!,
                method: "createNewTask",
                params: [
                    numToSquare,
                    THRESHOLD_PERCENT,
                    this.web3.utils.hexToBytes('0x00')
                ],
                abi: SquaringABIs.TASK_MANAGER_ABI,
                pkWallet: this.pkWallet!,
                // @ts-ignore
                web3: this.web3,
            })

            const event: any = decodeTxReceiptLogs(txReceipt, SquaringABIs.TASK_MANAGER_ABI)[0];

            const taskIndex = event.taskIndex;
            this.tasks[taskIndex] = event.task;

            logger.debug(`Successfully sent the new task ${taskIndex}`);
            return taskIndex;
        } catch (e: any) {
            logger.error(`Aggregator failed to send number to square: ${e.message}`);
            return null;
        }
    }

    private static verifySignature(data: SignatureData, operators: { [key: string]: Operator }): void {
        if (!(data.operatorId in operators)) {
            throw new OperatorNotRegisteredError('Operator not registered');
        }

        const encoded = abiEncodeData(['uint32', 'uint256'], [data.taskIndex, data.numberSquared]);
        const taskResponseDigest = keccak256(encoded);

        const pubKeyG2 = operators[data.operatorId].publicKeyG2!;
        const signature = new Signature(
            BigInt(data.signature.x),
            BigInt(data.signature.y)
        );
        const verified = signature.verify(pubKeyG2, taskResponseDigest);
        if (!verified) {
            throw new SignatureVerificationError('Signature verification failed');
        }
    }

    public async submitSignature(req: Request, res: Response): Promise<void> {
        try {
            const data: SignatureData = req.body;
            logger.debug(`Received signed task response: ${JSON.stringify(data)}`);

            const taskIndex = data.taskIndex;
            if (!(taskIndex in this.tasks)) {
                throw new TaskNotFoundError();
            }
            if (this.tasksDone[taskIndex]) {
                res.status(200).json({
                    success: true,
                    message: 'Task already responded'
                });
                return;
            }

            const operators = await this.operatorsInfo(data.blockNumber);

            Aggregator.verifySignature(data, operators);

            const operatorId = data.operatorId;

            if (!(taskIndex in this.responses)) {
                this.responses[taskIndex] = {};
            }

            if (operatorId in this.responses[taskIndex]) {
                throw new OperatorAlreadyProcessedError();
            }

            this.responses[taskIndex][operatorId] = data;
            const signerOperatorIds = Object.keys(this.responses[taskIndex]).filter(
                id => this.responses[taskIndex][id].numberSquared === data.numberSquared
            );

            const signedStake = signerOperatorIds.reduce(
                (sum, id) => sum + operators[id].stake, 0
            );
            const totalStake = Object.values(operators).reduce(
                (sum, op) => sum + op.stake, 0
            );

            logger.debug('Signature processed successfully', {
                taskIndex,
                operatorId,
                signedStake,
                totalStake,
                threshold: THRESHOLD_PERCENT
            });

            if (totalStake > 0 && signedStake / totalStake < THRESHOLD_PERCENT / 100) {
                res.status(200).json({
                    success: true,
                    message: 'Signature accepted, threshold not yet reached'
                });
                return;
            }
            this.tasksDone[taskIndex] = true;

            const signatures = signerOperatorIds.map(id => this.responses[taskIndex][id].signature);
            const nonSignersPubkeysG1 = Object.keys(operators)
                .filter(id => !signerOperatorIds.includes(id))
                .map(id => operators[id].publicKeyG1!);
            const quorumApksG1 = Object.values(operators)
                .map(op => op.publicKeyG1!)
                .reduce((sum, g1) => sum.add(g1), newZeroG1Point());
            const signersApkG2 = signerOperatorIds
                .map(id => operators[id].publicKeyG2!)
                .reduce((sum, g2) => sum.add(g2), newZeroG2Point());
            const signersAggSigG1 = signatures
                .map(sig => new Signature(BigInt(sig.x), BigInt(sig.y)))
                .reduce((sum, sig) => sum.add(sig), new Signature(0n, 0n));

            const indices = await this.clients!.avsRegistryReader.getCheckSignaturesIndices(
                BigInt(data.blockNumber),
                [0n],
                Object.keys(operators)
                    .filter(id => !signerOperatorIds.includes(id))
                // .map(id => id.substring(2))
            );

            await mineBlocks(this.web3, 10);

            console.log(`Aggregator: submitting task ${taskIndex}.`)
            await this.submitAggregatedResponse({
                taskIndex: BigInt(data.taskIndex),
                blockNumber: BigInt(data.blockNumber),
                numberSquared: BigInt(data.numberSquared),
                numberToBeSquared: BigInt(this.tasks[taskIndex].numberToBeSquared),
                nonSignersPubkeysG1,
                quorumApksG1: [quorumApksG1],
                signersApkG2,
                signersAggSigG1,
                nonSignerQuorumBitmapIndices: indices.nonSignerQuorumBitmapIndices,
                quorumApkIndices: indices.quorumApkIndices,
                totalStakeIndices: indices.totalStakeIndices,
                nonSignerStakeIndices: indices.nonSignerStakeIndices
            });
            console.log(`Aggregator: task ${taskIndex} submited onchain successfully.`)

            res.status(200).json({
                success: true,
                message: 'Threshold reached, aggregated response submitted'
            });
        } catch (e: any) {
            // print stack trace
            console.error("Error on Aggregator.submitSignature", e)

            if (e instanceof TaskNotFoundError) {
                logger.error(`Task not found: ${e.toString()}`);
                res.status(400).json({ success: false, error: e.toString() });
            } else if (e instanceof OperatorNotRegisteredError) {
                logger.error(`Operator not registered: ${e.toString()}`);
                res.status(400).json({ success: false, error: e.toString() });
            } else if (e instanceof OperatorAlreadyProcessedError) {
                logger.error(`Operator already processed: ${e.toString()}`);
                res.status(400).json({ success: false, error: e.toString() });
            } else if (e instanceof SignatureVerificationError) {
                logger.error(`Signature verification failed: ${e.toString()}`);
                res.status(400).json({ success: false, error: e.toString() });
            } else {
                logger.error(`Internal server error: ${e.message}`);
                res.status(500).json({ success: false, error: '500. Internal server error' });
            }
        }
    }

    private async submitAggregatedResponse(response: AggregatedResponse): Promise<void> {
        logger.debug('Submitting aggregated response to contract', { taskIndex: response.taskIndex });

        const task = [
            response.numberToBeSquared,
            response.blockNumber,
            '0x00',
            THRESHOLD_PERCENT
        ];
        const taskResponse = [response.taskIndex, response.numberSquared];
        const nonSignersStakesAndSignature = [
            response.nonSignerQuorumBitmapIndices,
            response.nonSignersPubkeysG1.map(g1 => g1ToTuple(g1)),
            response.quorumApksG1.map(g1 => g1ToTuple(g1)),
            g2ToTuple(response.signersApkG2, "ba"),
            g1ToTuple(response.signersAggSigG1),
            response.quorumApkIndices,
            response.totalStakeIndices,
            response.nonSignerStakeIndices
        ];

        const receipt = await sendContractCall({
            contract: this.taskManager!,
            method: "respondToTask",
            params: [
                task,
                taskResponse,
                nonSignersStakesAndSignature
            ],
            abi: [
                ...Object.values(SquaringABIs).flat(),
                ...Object.values(sdkABIs).flat()
            ],
            pkWallet: this.pkWallet!,
            // @ts-ignore
            web3: this.web3,
        })

        // const tx = this.taskManager!.methods.respondToTask(
        //     task,
        //     taskResponse,
        //     nonSignersStakesAndSignature
        // ).encodeABI();

        // const transaction = {
        //     from: this.aggregatorAddress,
        //     to: this.taskManager!.options.address,
        //     gas: 2000000,
        //     gasPrice: this.web3.utils.toWei('20', 'gwei'),
        //     nonce: await this.web3.eth.getTransactionCount(this.aggregatorAddress!),
        //     chainId: await this.web3.eth.getChainId(),
        //     data: tx
        // };

        // const signedTx = await this.web3.eth.accounts.signTransaction(transaction, this.aggregatorEcdsaPrivateKey!);
        // const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);

        logger.debug('Aggregated response sent successfully', { txHash: receipt.transactionHash });
    }

    private startServer(): void {
        const [host, port] = this.config.aggregatorServerIpPortAddress.split(':');
        this.app!.listen(parseInt(port), host, () => {
            logger.info(`Server running on ${host}:${port}`);
        });
    }

    private async loadEcdsaKey() {
        const ecdsaKeyPassword = process.env.AGGREGATOR_ECDSA_KEY_PASSWORD || '';
        if (!ecdsaKeyPassword) {
            logger.warn('AGGREGATOR_ECDSA_KEY_PASSWORD not set. using empty string.');
        }

        const keystore = JSON.parse(fs.readFileSync(this.config.ecdsaPrivateKeyStorePath, 'utf8'));
        const account = await this.web3.eth.accounts.decrypt(keystore, ecdsaKeyPassword);

        this.pkWallet = {
            privateKey: account.privateKey,
            address: account.address
        }

        this.aggregatorEcdsaPrivateKey = account.privateKey;
        this.aggregatorAddress = account.address;
    }

    private async loadClients() {
        const cfg: BuildAllConfig = new BuildAllConfig({
            avsName: AVS_NAME,
            ethHttpUrl: this.config.ethRpcUrl,
            registryCoordinatorAddr: this.config.avsRegistryCoordinatorAddress,
            operatorStateRetrieverAddr: this.config.operatorStateRetrieverAddress,
            rewardsCoordinatorAddr: this.config.rewardsCoordinatorAddress,
            permissionControllerAddr: this.config.permissionControllerAddress,
            serviceManagerAddr: this.config.serviceManagerAddress,
            allocationManagerAddr: this.config.allocationManagerAddress,
            delegationManagerAddr: this.config.delegationManagerAddress
        });
        this.clients = await buildAll(cfg, this.aggregatorEcdsaPrivateKey!);
    }

    private async loadTaskManager(): Promise<void> {
        const serviceManagerAddress = this.clients!.avsRegistryWriter.serviceManagerAddr;
        const serviceManager = new this.web3.eth.Contract(SquaringABIs.SERVICE_MANAGER_ABI, serviceManagerAddress);

        const taskManagerAddress: string = await serviceManager.methods.incredibleSquaringTaskManager().call();
        this.taskManager = new this.web3.eth.Contract(SquaringABIs.TASK_MANAGER_ABI, taskManagerAddress);
    }

    public async operatorsInfo(block: number): Promise<{ [key: string]: Operator }> {
        const query = `
        {
            operators(block: { number: ${block} }) {
                id
                operatorId
                socket
                stake
                pubkeyG1_X
                pubkeyG1_Y
                pubkeyG2_X
                pubkeyG2_Y
            }
        }
        `;
        const response = await axios({
            method: "post",
            url: this.subgraphUrl,
            headers: { 'Content-Type': 'application/json' },
            data: { query }
        });

        if (response.status >= 400) {
            throw new Error(`GraphQL request failed with status ${response.status}`);
        }

        const operators: Operator[] = response.data.data.operators;
        const result: { [key: string]: Operator } = {};

        for (const op of operators) {
            op.publicKeyG1 = new G1Point(BigInt(op.pubkeyG1_X), BigInt(op.pubkeyG1_Y));
            op.publicKeyG2 = new G2Point(
                BigInt(op.pubkeyG2_X[1]),
                BigInt(op.pubkeyG2_X[0]),
                BigInt(op.pubkeyG2_Y[1]),
                BigInt(op.pubkeyG2_Y[0])
            );
            op.stake = parseFloat(op.stake);
            result[op.operatorId] = op;
        }

        return result;
    }
}

async function main(): Promise<void> {
    await blsInit()

    const aggregatorConfig = yamlLoad('./config-files/aggregator.yaml') as Config;
    const avsConfig = yamlLoad('./config-files/avs.yaml') as Config;

    const aggregator = new Aggregator({ ...aggregatorConfig, ...avsConfig });
    await aggregator.init();

    // process.on('SIGINT', async () => {
    //     logger.info("Terminating aggregator ...")
    //     aggregator.stop()
    // });

    await aggregator.start();
}

if (require.main === module) {
    main()
        .catch(e => {
            console.dir(e, { depth: 6 })
            console.log(`An error occurred. terminating aggregator process.`)
        })
        .finally(() => {
            process.exit(0)
        })
}
