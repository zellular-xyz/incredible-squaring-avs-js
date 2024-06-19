import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import { Web3 } from 'web3';
import { ethers, Wallet } from 'ethers';
import { ABI } from 'ethereumjs-abi';
import * as winston from 'winston';
import { BuildAllConfig, buildAll } from 'eigensdk/chainio/clients/builder';
import { AvsRegistryService } from 'eigensdk/services/avsregistry';
import { OperatorsInfoServiceInMemory } from 'eigensdk/services/operatorsinfo/operatorsinfo_inmemory';
import { BlsAggregationService, BlsAggregationServiceResponse } from 'eigensdk/services/bls_aggregation/blsagg';
import { numsToBytes } from 'eigensdk/chainio/utils';
import { Signature, G1Point, G2Point, g1ToTuple, g2ToTuple } from 'eigensdk/crypto/bls/attestation';

// Logger setup
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console()
    ]
});

class Aggregator {
    private web3: Web3;
    private config: any;
    private aggregatorAddress: string;
    private aggregatorECDSAPrivateKey: string;
    private clients: any;
    private taskManager: any;
    private blsAggregationService: BlsAggregationService;
    private app: express.Application;

    constructor(config: any) {
        this.config = config;
        this.web3 = new Web3(new Web3.providers.HttpProvider(this.config.eth_rpc_url));
        this.loadECDSAKey();
        this.loadClients();
        this.loadTaskManager();
        this.loadBlsAggregationService();
        this.app = express();
        this.app.use(bodyParser.json());
        this.app.post('/signature', this.submitSignature.bind(this));
    }

    private loadECDSAKey(): void {
        const ecdsaKeyPassword = process.env.AGGREGATOR_ECDSA_KEY_PASSWORD || '';
        if (!ecdsaKeyPassword) {
            logger.warning("AGGREGATOR_ECDSA_KEY_PASSWORD not set. using empty string.");
        }
        const keystorePath = path.join(__dirname, this.config.ecdsa_private_key_store_path);
        const keystore = JSON.parse(fs.readFileSync(keystorePath, 'utf-8'));
        const wallet = ethers.Wallet.fromEncryptedJsonSync(JSON.stringify(keystore), ecdsaKeyPassword);
        this.aggregatorECDSAPrivateKey = wallet.privateKey;
        this.aggregatorAddress = wallet.address;
    }

    private loadClients(): void {
        const cfg = new BuildAllConfig(
            this.config.eth_rpc_url,
            this.config.eth_ws_url,
            "incredible-squaring",
            this.config.avs_registry_coordinator_address,
            this.config.operator_state_retriever_address,
            ""
        );
        this.clients = buildAll(cfg, this.aggregatorECDSAPrivateKey, logger);
    }

    private loadTaskManager(): void {
        const serviceManagerAddress = this.clients.avsRegistryWriter.serviceManagerAddr;
        const serviceManagerABI = fs.readFileSync("abis/IncredibleSquaringServiceManager.json", "utf-8");
        const serviceManager = new this.web3.eth.Contract(JSON.parse(serviceManagerABI), serviceManagerAddress);
        const taskManagerAddress = serviceManager.methods.incredibleSquaringTaskManager().call();
        const taskManagerABI = fs.readFileSync("abis/IncredibleSquaringTaskManager.json", "utf-8");
        this.taskManager = new this.web3.eth.Contract(JSON.parse(taskManagerABI), taskManagerAddress);
    }

    private loadBlsAggregationService(): void {
        const operatorInfoService = new OperatorsInfoServiceInMemory(
            this.clients.avsRegistryReader,
            0,
            0,
            logger
        );

        const avsRegistryService = new AvsRegistryService(
            this.clients.avsRegistryReader,
            operatorInfoService,
            logger
        );

        const hasher = (task: any) => {
            const encoded = ABI.rawEncode(["uint32", "uint256"], [task.taskIndex, task.numberSquared]);
            return ethers.utils.keccak256(encoded);
        };

        this.blsAggregationService = new BlsAggregationService(avsRegistryService, hasher);
    }

    public submitSignature(req: Request, res: Response): void {
        const data = req.body;
        const signature = new Signature(data.signature.X, data.signature.Y);
        const taskIndex = data.task_id;
        const taskResponse = {
            taskIndex,
            numberSquared: data.number_squared,
            numberToBeSquared: data.number_to_be_squared,
            blockNumber: data.block_number
        };

        try {
            this.blsAggregationService.processNewSignature(
                taskIndex, taskResponse, signature, data.operator_id
            );
            res.status(200).send('true');
        } catch (e) {
            logger.error(`Submitting signature failed: ${e}`);
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
            i, 100, numsToBytes([0])
        ).send({
            from: this.aggregatorAddress,
            gas: 2000000,
            gasPrice: this.web3.utils.toWei('20', 'gwei'),
            nonce: await this.web3.eth.getTransactionCount(this.aggregatorAddress),
            chainId: await this.web3.eth.net.getId()
        });

        const receipt = await tx;
        const event = this.taskManager.events.NewTaskCreated().processLog(receipt.logs[0]);
        const taskIndex = event.returnValues.taskIndex;
        logger.info(`Successfully sent the new task ${taskIndex}`);
        this.blsAggregationService.initializeNewTask(
            taskIndex,
            receipt.blockNumber,
            numsToBytes([0]),
            [100],
            60000
        );
        return taskIndex;
    }

    public startSendingNewTasks(): void {
        let i = 0;
        setInterval(async () => {
            logger.info('Sending new task');
            await this.sendNewTask(i);
            i += 1;
        }, 10000);
    }

    public async startSubmittingSignatures(): Promise<void> {
        while (true) {
            logger.info('Waiting for response');
            const aggregatedResponse = await this.blsAggregationService.getAggregatedResponses();
            if (!aggregatedResponse) continue;

            logger.info(`Aggregated response ${aggregatedResponse}`);
            const response = aggregatedResponse.taskResponse;

            const task = [
                response.numberToBeSquared,
                response.blockNumber,
                numsToBytes([0]),
                100,
            ];
            const taskResponse = [
                response.taskIndex,
                response.numberSquared
            ];
            const nonSignersStakesAndSignature = [
                aggregatedResponse.nonSignerQuorumBitmapIndices,
                aggregatedResponse.nonSignersPubkeysG1.map(g1ToTuple),
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
        }
    }
}

(async () => {
    const config = yaml.load(fs.readFileSync("config-files/aggregator.yaml", "utf8"));
    const aggregator = new Aggregator(config);
    aggregator.startSendingNewTasks();
    await aggregator.startSubmittingSignatures();
    aggregator.startServer();
})();
