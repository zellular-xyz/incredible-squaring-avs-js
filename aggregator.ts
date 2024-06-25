import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import { AbiItem, Web3, eth as Web3Eth } from 'web3';
import { ethers } from 'ethers';
import pino from 'pino';
import { Signature, init as blsInit } from "./eigensdk/crypto/bls/attestation"
import { AvsRegistryService } from './eigensdk/services/avsregistry/avsregistry';
import { BlsAggregationService, BlsAggregationServiceResponse } from './eigensdk/services/bls-aggregation/blsagg';
import { OperatorsInfoServiceInMemory } from './eigensdk/services/operatorsinfo/operatorsinfo-inmemory';
import { BuildAllConfig, buildAll } from './eigensdk/chainio/clients/builder';
import * as chainioUtils from './eigensdk/chainio/utils';
import {g1ToTuple, g2ToTuple, timeout} from './utils'
import {decodeTxReceiptLogs} from './eigensdk/utils/helpers'
import {AsyncQueue} from './eigensdk/services/bls-aggregation/async-queue';
import * as ABIs from './eigensdk/contracts/ABIs'

// Logger setup
const logger = pino({
    level: 'info', // Set log level here
    // prettyPrint: { colorize: true }
	transport: {
		target: 'pino-pretty'
	},
});

export const sigAggQue: AsyncQueue = new AsyncQueue();

class Aggregator {
	// @ts-ignore
    private web3: Web3;
    private config: any;
	// @ts-ignore
    private aggregatorAddress: string;
	// @ts-ignore
    private aggregatorECDSAPrivateKey: string;
    private clients: any;
	private taskManagerABI: AbiItem[] = [];
    private taskManager: any;
	// @ts-ignore
    private blsAggregationService: BlsAggregationService;
	// @ts-ignore
    private app: express.Application;

    constructor(config: any) {
        this.config = config;
    }

	async init(){
        this.web3 = new Web3(new Web3.providers.HttpProvider(this.config.eth_rpc_url));
        this.loadECDSAKey();
        await this.loadClients();
        await this.loadTaskManager();
        this.loadBlsAggregationService();
        this.app = express();
        this.app.use(bodyParser.json());
        this.app.post('/signature', this.submitSignature.bind(this));
	}

    private loadECDSAKey(): void {
        const ecdsaKeyPassword = process.env.AGGREGATOR_ECDSA_KEY_PASSWORD || '';
        if (!ecdsaKeyPassword) {
            logger.warn("AGGREGATOR_ECDSA_KEY_PASSWORD not set. using empty string.");
        }
        const keystorePath = path.join(__dirname, this.config.ecdsa_private_key_store_path);
        const keystore = JSON.parse(fs.readFileSync(keystorePath, 'utf-8'));
        const wallet = ethers.Wallet.fromEncryptedJsonSync(JSON.stringify(keystore), ecdsaKeyPassword);
        this.aggregatorECDSAPrivateKey = wallet.privateKey;
        this.aggregatorAddress = wallet.address;
    }

    private async loadClients(): Promise<void> {
        const cfg = new BuildAllConfig(
            this.config.eth_rpc_url,
            this.config.avs_registry_coordinator_address,
            this.config.operator_state_retriever_address,
            "incredible-squaring",
            this.config.eigen_metrics_ip_port_address
        );
        this.clients = await buildAll(cfg, this.aggregatorECDSAPrivateKey, logger);
    }

    private async loadTaskManager(): Promise<void> {
        const serviceManagerAddress = this.clients.avsRegistryWriter.serviceManagerAddr;
        const serviceManagerABI = fs.readFileSync("abis/IncredibleSquaringServiceManager.json", "utf-8");
        const serviceManager = new this.web3.eth.Contract(JSON.parse(serviceManagerABI), serviceManagerAddress);
        const taskManagerAddress:string = await serviceManager.methods.incredibleSquaringTaskManager().call();
        const taskManagerABI = fs.readFileSync("abis/IncredibleSquaringTaskManager.json", "utf-8");
		this.taskManagerABI = JSON.parse(taskManagerABI) as AbiItem[];
        this.taskManager = new this.web3.eth.Contract(this.taskManagerABI, taskManagerAddress);
    }

    private loadBlsAggregationService(): void {
        const operatorInfoService = new OperatorsInfoServiceInMemory(
            this.clients.avsRegistryReader,
            {logger},
        );

        const avsRegistryService:AvsRegistryService = new AvsRegistryService(
            this.clients.avsRegistryReader,
            operatorInfoService,
            logger
        );

        const hasher = (task: any) => {
            const encoded = Web3Eth.abi.encodeParameters(["uint32", "uint256"], [task.taskIndex, task.numberSquared]);
            return Web3.utils.keccak256(encoded);
        };

        this.blsAggregationService = new BlsAggregationService(avsRegistryService, hasher);
    }

    public async submitSignature(req: Request, res: Response): Promise<void> {
        const data = req.body;
        const signature = new Signature(BigInt(data.signature.X), BigInt(data.signature.Y));
        const taskIndex = data.task_id;
        const taskResponse = {
            taskIndex,
            numberSquared: data.number_squared,
            numberToBeSquared: data.number_to_be_squared,
            blockNumber: data.block_number
        };

        try {
            await this.blsAggregationService.processNewSignature(
                taskIndex, taskResponse, signature, data.operator_id
            );
            res.status(200).send('true');
        } catch (e) {
			// console.log(e)
            logger.error(e, `Submitting signature failed: ${e}`);
            res.status(500).send('false');
        }
    }

    public startServer(): void {
        const [host, port] = this.config.aggregator_server_ip_port_address.split(':');
        this.app.listen(parseInt(port, 10), host, () => {
            logger.info(`Server started at http://${host}:${port}`);
        });
    }

    public async sendNewTask(i: number): Promise<number> {
        const tx = this.taskManager.methods.createNewTask(
            i, 100, chainioUtils.numsToBytes([0])
        ).send({
            from: this.aggregatorAddress,
            gas: 2000000,
            gasPrice: this.web3.utils.toWei('20', 'gwei'),
            nonce: await this.web3.eth.getTransactionCount(this.aggregatorAddress),
            chainId: await this.web3.eth.net.getId()
        });

        const receipt = await tx;
		// @ts-ignore
        const event = decodeTxReceiptLogs(receipt, this.taskManagerABI)[0];
        const taskIndex = event.taskIndex;
        logger.info(`Successfully sent the new task ${taskIndex}`);
        const taskInfo = await this.blsAggregationService.initializeNewTask(
            taskIndex,
            receipt.blockNumber,
            [0],
            [100],
            60000
        );
        return taskIndex;
    }

    public async startSendingNewTasks(): Promise<void> {
        let i = 0;
		while(true){
            logger.info('Sending new task');

            await this.sendNewTask(i);
            i += 1;
			
			await timeout(10000)
		}
    }

    public async startSubmittingSignatures(): Promise<void> {
        const aggregatedResponseChannel = this.blsAggregationService.getAggregatedResponseChannel();

		for await (const _aggResponse of aggregatedResponseChannel) {
			const aggregatedResponse:BlsAggregationServiceResponse = _aggResponse;

            logger.info({
				taskIndex: aggregatedResponse.taskIndex,
				taskResponse: aggregatedResponse.taskResponse,
			}, `Task response aggregated.`);
            const response = aggregatedResponse.taskResponse;

            const task = [
                response.numberToBeSquared,
                response.blockNumber,
                chainioUtils.numsToBytes([0]),
                100,
            ];
            const taskResponse = [
                response.taskIndex,
                response.numberSquared
            ];
            const nonSignersStakesAndSignature = [
                aggregatedResponse.nonSignerQuorumBitmapIndices,
                aggregatedResponse.nonSignersPubKeysG1.map(g1ToTuple),
                aggregatedResponse.quorumApksG1.map(g1ToTuple),
                g2ToTuple(aggregatedResponse.signersApkG2),
                g1ToTuple(aggregatedResponse.signersAggSigG1),
                aggregatedResponse.quorumApkIndices,
                aggregatedResponse.totalStakeIndices,
                aggregatedResponse.nonSignerStakeIndices,
            ];

            const tx = this.taskManager.methods.respondToTask(
                task, taskResponse, nonSignersStakesAndSignature
            ).send({
                from: this.aggregatorAddress,
                gas: 2000000,
                gasPrice: this.web3.utils.toWei('20', 'gwei'),
                nonce: await this.web3.eth.getTransactionCount(this.aggregatorAddress),
                chainId: await this.web3.eth.net.getId()
            });

            const receipt = await tx;
			logger.info({
				taskIndex: response.taskIndex,
				txHash: receipt.transactionHash
			}, "Task response registered onchain.")
        }
    }
}

async function main() {
	await blsInit()

    const config = yaml.load(fs.readFileSync("config-files/aggregator.yaml", "utf8"));

    const aggregator = new Aggregator(config);
	await aggregator.init()

	return Promise.all([
		aggregator.startSendingNewTasks(),
		aggregator.startSubmittingSignatures(),
		aggregator.startServer()
	])
}

main()
	.catch(e => {
		console.dir(e, {depth: 6})
		console.log(`An error occurred. terminating aggregator process.`)
	})
	.finally(() => {
		process.exit(0)
	})
