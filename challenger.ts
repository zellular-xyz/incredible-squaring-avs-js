import fs from "fs";
import path from "path";
import pino from "pino";
import Web3 from "web3";
import { yamlLoad } from "./utils";
import { EventPoller } from "./event-poller";
import ABI from "./abis/IncredibleSquaringTaskManager.json";

// --- Setup Logger ---
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

// --- Types (equivalent to Python dataclasses) ---
interface Task {
    numberToBeSquared: number;
    taskCreatedBlock: number;
    quorumNumbers: string; // hex string
    quorumThresholdPercentage: number;
}

interface TaskResponse {
    numberSquared: number;
    referenceTaskIndex: number;
}

interface TaskResponseMetadata {
    taskResponsedBlock: number;
    hashOfNonSigners: string; // hex string
}

interface TaskResponseData {
    taskResponse: TaskResponse;
    taskResponseMetadata: TaskResponseMetadata;
    nonSigningOperatorPubKeys: Array<{ X: string; Y: string }>;
}

// --- Custom Errors ---
class ChallengerError extends Error { }
class KeyLoadError extends ChallengerError { }
class TaskNotFoundError extends ChallengerError {
    toString() { return "400. Task not found"; }
}
class TransactionError extends ChallengerError {
    toString() { return "500. Failed to execute transaction"; }
}
class TaskResponseParsingError extends ChallengerError {
    toString() { return "500. Failed to parse task response"; }
}
class NoErrorInTaskResponse extends ChallengerError {
    toString() { return "100. Task response is valid"; }
}

// --- Challenger Service ---
export class Challenger {
    public config: any;
    public web3: Web3;
    public taskManager: any;

    public tasks: Record<number, Task> = {};
    public taskResponses: Record<number, TaskResponseData> = {};
    public challengeHashes: Record<number, string> = {};

    public challengerAddress!: string;
    public challengerPrivateKey!: string;

    public stopFlag = false;
    private eventPoller?: EventPoller<typeof ABI>;

    constructor(config: any) {
        this.config = config;
        this.web3 = new Web3(new Web3.providers.HttpProvider(config.ethRpcUrl));
    }

    async init() {
        // load key + contracts
        await this.loadECDSAKey();
        await this.loadTaskManager();

        this.eventPoller = new EventPoller(this.web3, this.taskManager, ["NewTaskCreated", "TaskResponded"]);
    }

    async start() {
        logger.debug("Starting Challenger...");
        // subscribe to events
        // this.taskManager.events.NewTaskCreated({ fromBlock: "latest" })
        //     .on("data", (event: any) => this.processNewTaskCreatedLog(event))
        //     .on("error", (err: any) => logger.error({ err }, "NewTaskCreated subscription error"));

        // this.taskManager.events.TaskResponded({ fromBlock: "latest" })
        //     .on("data", (event: any) => this.processTaskResponseLog(event))
        //     .on("error", (err: any) => logger.error({ err }, "TaskResponded subscription error"));

        if(!this.eventPoller)
            throw `eventPoller not initialized`

        this.eventPoller
            .on("NewTaskCreated", (event: any) => this.processNewTaskCreatedLog(event))
            .on("TaskResponded", (event: any) => this.processTaskResponseLog(event))
            .on("error", (err: any) => console.log(">>>>>>>", err))

        this.eventPoller.start()

        logger.info("Listening for events...");
    }

    stop() {
        this.eventPoller?.stop();
        this.stopFlag = true;
        logger.debug("Stopping Challenger.");
    }

    private async processNewTaskCreatedLog(event: any) {
        console.log("======== NewTaskCreated", event)
        try {
            const taskIndex = parseInt(event.returnValues.taskIndex);
            const task: Task = {
                numberToBeSquared: parseInt(event.returnValues.task.numberToBeSquared),
                taskCreatedBlock: parseInt(event.returnValues.task.taskCreatedBlock),
                quorumNumbers: event.returnValues.task.quorumNumbers,
                quorumThresholdPercentage: parseInt(event.returnValues.task.quorumThresholdPercentage),
            };
            this.tasks[taskIndex] = task;

            logger.debug({ taskIndex, task }, "Processed new task");

            if (this.taskResponses[taskIndex]) {
                await this.callChallengeModule(taskIndex);
            }
        } catch (err) {
            logger.error({ err }, "Error processing NewTaskCreated log");
        }
    }

    private async processTaskResponseLog(event: any) {
        console.log("======== TaskResponse", event)
        try {
            const taskResponse: TaskResponse = {
                numberSquared: parseInt(event.returnValues.taskResponse.numberSquared),
                referenceTaskIndex: parseInt(event.returnValues.taskResponse.referenceTaskIndex),
            };

            const taskResponseMetadata: TaskResponseMetadata = {
                taskResponsedBlock: parseInt(event.returnValues.taskResponseMetadata.taskResponsedBlock),
                hashOfNonSigners: event.returnValues.taskResponseMetadata.hashOfNonSigners,
            };

            const nonSigningOperatorPubKeys = event.returnValues.nonSigningOperatorPubKeys || [];

            const taskResponseData: TaskResponseData = {
                taskResponse,
                taskResponseMetadata,
                nonSigningOperatorPubKeys,
            };

            const taskIndex = taskResponse.referenceTaskIndex;
            this.taskResponses[taskIndex] = taskResponseData;

            logger.debug({ taskIndex, taskResponse }, "Processed task response");

            if (this.tasks[taskIndex]) {
                await this.callChallengeModule(taskIndex);
            }
        } catch (err) {
            logger.error({ err }, "Failed to process TaskResponse log");
        }
    }

    private async callChallengeModule(taskIndex: number) {
        if (!this.tasks[taskIndex]) throw new TaskNotFoundError();

        const numberToBeSquared = this.tasks[taskIndex].numberToBeSquared;
        const answerInResponse = this.taskResponses[taskIndex].taskResponse.numberSquared;
        const trueAnswer = numberToBeSquared ** 2;

        if (trueAnswer !== answerInResponse) {
            logger.debug({ expected: trueAnswer, got: answerInResponse }, "Incorrect squared result");
            await this.raiseChallenge(taskIndex);
        } else {
            logger.debug("Correct squared result");
            throw new NoErrorInTaskResponse();
        }
    }

    private async raiseChallenge(taskIndex: number) {
        try {
            const task = this.tasks[taskIndex];
            const respData = this.taskResponses[taskIndex];

            const tx = this.taskManager.methods.raiseAndResolveChallenge(
                [task.numberToBeSquared, task.taskCreatedBlock, task.quorumNumbers, task.quorumThresholdPercentage],
                [respData.taskResponse.referenceTaskIndex, respData.taskResponse.numberSquared],
                [respData.taskResponseMetadata.taskResponsedBlock, respData.taskResponseMetadata.hashOfNonSigners],
                respData.nonSigningOperatorPubKeys
            );

            const gas = await tx.estimateGas({ from: this.challengerAddress });
            const gasPrice = await this.web3.eth.getGasPrice();

            const signedTx = await this.web3.eth.accounts.signTransaction(
                {
                    to: this.taskManager.options.address,
                    data: tx.encodeABI(),
                    gas,
                    gasPrice,
                },
                this.challengerPrivateKey
            );

            if (!signedTx.rawTransaction) throw new TransactionError();

            const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);
            logger.info({ txHash: receipt.transactionHash }, "Challenge raised");

            this.challengeHashes[taskIndex] = receipt.transactionHash;
        } catch (err) {
            logger.error({ err }, "Error raising challenge");
            throw new TransactionError();
        }
    }

    private async loadECDSAKey() {
        const keystorePath = this.config.ecdsaPrivateKeyStorePath;
        if (!fs.existsSync(keystorePath)) {
            throw new KeyLoadError(`ECDSA key file not found: ${keystorePath}`);
        }
        const keystore = JSON.parse(fs.readFileSync(keystorePath, "utf-8"));
        const password = process.env.CHALLENGER_ECDSA_KEY_PASSWORD || "";
        const account = this.web3.eth.accounts.decrypt(keystore, password);
        this.challengerPrivateKey = account.privateKey;
        this.challengerAddress = account.address;
        logger.debug({ challengerAddress: this.challengerAddress }, "ECDSA key loaded");
    }

    private async loadTaskManager() {
        const serviceManagerAbi = JSON.parse(fs.readFileSync("abis/IncredibleSquaringServiceManager.json", "utf-8"));
        const serviceManager = new this.web3.eth.Contract(serviceManagerAbi, this.config.serviceManagerAddress);

        const taskManagerAddr = await serviceManager.methods.incredibleSquaringTaskManager().call();

        const taskManagerAbi = JSON.parse(fs.readFileSync("abis/IncredibleSquaringTaskManager.json", "utf-8"));
        this.taskManager = new this.web3.eth.Contract(taskManagerAbi, taskManagerAddr);

        logger.debug({ taskManagerAddr }, "Task manager loaded");
    }
}

// --- Entrypoint ---
async function main() {
    const dirPath = __dirname;

    const challengerConfigPath = path.join(dirPath, "./config-files/challenger.yaml");
    const avsConfigPath = path.join(dirPath, "./config-files/avs.yaml");

    const challengerConfig = yamlLoad(challengerConfigPath) as any;
    const avsConfig = yamlLoad(avsConfigPath) as any;

    const challenger = new Challenger({ ...challengerConfig, ...avsConfig });
    await challenger.start();
}


if (require.main === module) {
    main().catch((err) => {
        logger.error({ err }, "Fatal error in Challenger");
        process.exit(1);
    });
}
