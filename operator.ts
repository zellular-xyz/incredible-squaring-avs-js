import * as fs from 'fs';
import axios from 'axios'
import * as yaml from 'js-yaml';
import Web3, {eth as web3Eth} from 'web3';
// import * as ethAccount from 'eth-lib/lib/account';
// import { Operator } from 'eigensdk/dist/_types';
import pino from 'pino';
import { KeyPair, Signature, init as cryptoLibInit } from "./eigensdk/crypto/bls/attestation"
import { Operator } from './eigensdk/services/avsregistry/avsregistry';
import { BuildAllConfig, Clients, buildAll } from './eigensdk/chainio/clients/builder';
import { OperatorId } from './eigensdk/types/general';
import {timeout} from './utils'
import { g1PointToArgs } from './eigensdk/utils/helpers';

const logger = pino({
    level: 'info', // Set log level here
    // prettyPrint: { colorize: true }
	transport: {
		target: 'pino-pretty'
	},
});

class SquaringOperator {
    private config: any;
    private blsKeyPair?: KeyPair;
    private operatorEcdsaPrivateKey?: string;
	// @ts-ignore
    private clients: Clients; // Adjust type based on the actual type inferred or defined
    private taskManager: any; // Adjust type based on the actual type inferred or defined
    private operatorId?: OperatorId;

    constructor(config: any) {
        this.config = config;
    }

	async init() {
        await this.loadBlsKey();
		logger.info("BLS key loaded.")
        await this.loadEcdsaKey();
		logger.info("ECDSA key loaded.")
        await this.loadClients();
		logger.info("Clients key loaded.")
        await this.loadTaskManager();
		logger.info("TaskMan key loaded.")
        if (this.config.register_operator_on_startup === true) {
			await this.register();
			logger.info("Register done.")
        }
        // operator id can only be loaded after registration
        await this.loadOperatorId();
		logger.info(`OperatorId loaded: ${this.operatorId}.`)
	}

    public async register(): Promise<void> {
        const operator: Operator = {
            address: this.config.operator_address,
            earningsReceiverAddress: this.config.operator_address,
            delegationApproverAddress: "0x0000000000000000000000000000000000000000",
            stakerOptOutWindowBlocks: 0,
            metadataUrl: "",
        };
		
		const alreadyElRegistered = await this.clients.elReader.isOperatorRegistered(this.config.operator_address)
		if(!alreadyElRegistered){
			logger.info("Registering ElContract ...")
        	await this.clients.elWriter.registerAsOperator(operator);
		}
		const alreadyAvsRegistered = await this.clients.avsRegistryReader.isOperatorRegistered(this.config.operator_address)
		if(!alreadyAvsRegistered){
			logger.info("Registering AvsRegistryCoordinator ...")
			await this.clients.avsRegistryWriter.registerOperatorInQuorumWithAvsRegistryCoordinator(
				this.operatorEcdsaPrivateKey!,
				// Web3.utils.randomBytes(32),
				Web3.utils.randomHex(32),
				Math.floor(Date.now() / 1000) + 3600,
				this.blsKeyPair!,
				[0],
				"Not Needed",
			);
		}
    }

    public async start(): Promise<void> {
        logger.info("Starting Operator...");
		let latestBlock:bigint|string = 'latest';
		const web3 = new Web3(new Web3.providers.HttpProvider(this.config.eth_rpc_url));
	
		while (true) {
			try {
				const currentBlock = await web3.eth.getBlockNumber();
				const events:any[] = await this.taskManager.getPastEvents("NewTaskCreated", {
					fromBlock: latestBlock,
					toBlock: currentBlock
				});
	
				events.forEach(event => {
					logger.info(event, 'Event received:');
					this.processTaskEvent(event)
				});
	
				latestBlock = currentBlock + 1n; // Move to the next block for the next poll
			} catch (error) {
				logger.error(error, 'Error polling for events:');
			}
	
			await timeout(5000);
		}
    }

    public processTaskEvent(event: any): void {
        const taskIndex: number = event.returnValues.taskIndex;
        const numberToBeSquared: bigint = event.returnValues.task.numberToBeSquared;
        const numberSquared: bigint = numberToBeSquared ** 2n;
        const encoded: string = web3Eth.abi.encodeParameters(["uint32", "uint256"], [taskIndex, numberSquared]);
        const hashBytes: string = Web3.utils.keccak256(encoded);
        const signature: Signature = this.blsKeyPair?.signMessage(hashBytes)!;
        logger.info(
            `Signature generated, task id: ${taskIndex}, number squared: ${numberSquared}, signature: ${signature.getStr()}`
        );
        const data = {
            task_id: taskIndex.toString(10),
            number_to_be_squared: "0x"+numberToBeSquared.toString(16),
            number_squared: "0x"+numberSquared.toString(16),
            signature: g1PointToArgs(signature),
            block_number: "0x"+event.blockNumber.toString(16),
            operator_id: this.operatorId,
        };
        logger.info(`Submitting result for task to aggregator ${JSON.stringify(data)}`);
        // prevent submitting task before initialize_new_task gets completed on aggregator
        setTimeout(() => {
            const url = `http://${this.config.aggregator_server_ip_port_address}/signature`;
            axios.post(url, data)
			.catch(e => {
				logger.error(`An error occurred when sending signature to TaskIndex: ${taskIndex}`, e)
			})
        }, 3000);
    }

    private async loadBlsKey(): Promise<void> {
        const blsKeyPassword: string | undefined = process.env.OPERATOR_BLS_KEY_PASSWORD || "";
        if (!blsKeyPassword) {
            logger.warn("OPERATOR_BLS_KEY_PASSWORD not set. using empty string.");
        }
		this.blsKeyPair = await KeyPair.readFromFile(
			this.config.bls_private_key_store_path, blsKeyPassword
		);
		logger.info(`BLS key: ${this.blsKeyPair?.pubG1.getStr()}`)
    }

    private async loadEcdsaKey(): Promise<void> {
        const ecdsaKeyPassword: string | undefined = process.env.OPERATOR_ECDSA_KEY_PASSWORD || "";
        if (!ecdsaKeyPassword) {
            logger.warn("OPERATOR_ECDSA_KEY_PASSWORD not set. using empty string.");
        }

        const keystore: any = JSON.parse(fs.readFileSync(this.config.ecdsa_private_key_store_path, 'utf8'));
        // this.operatorEcdsaPrivateKey = ethAccount.decrypt(keystore, ecdsaKeyPassword).toString('hex');
		const web3 = new Web3();
		const account = await web3.eth.accounts.decrypt(keystore, ecdsaKeyPassword)
        this.operatorEcdsaPrivateKey = account.privateKey;
    }

    private async loadClients(): Promise<void> {
        const cfg: BuildAllConfig = new BuildAllConfig(
            this.config.eth_rpc_url,
            this.config.avs_registry_coordinator_address,
            this.config.operator_state_retriever_address,
            "incredible-squaring",
            this.config.eigen_metrics_ip_port_address,
		);
        this.clients = await buildAll(cfg, this.operatorEcdsaPrivateKey!, logger);
    }

    private async loadTaskManager(): Promise<void> {
        const web3: Web3 = new Web3(new Web3.providers.HttpProvider(this.config.eth_rpc_url));

        const serviceManagerAddress: string = this.clients.avsRegistryWriter.serviceManagerAddr;
        const serviceManagerAbi: any = JSON.parse(fs.readFileSync("abis/IncredibleSquaringServiceManager.json", 'utf8'));
        const serviceManager = new web3.eth.Contract(serviceManagerAbi, serviceManagerAddress);

        const taskManagerAddress: string = await serviceManager.methods.incredibleSquaringTaskManager().call();
        const taskManagerAbi: any = JSON.parse(fs.readFileSync("abis/IncredibleSquaringTaskManager.json", 'utf8'));
        this.taskManager = new web3.eth.Contract(taskManagerAbi, taskManagerAddress);
    }

    private async loadOperatorId(): Promise<void> {
        this.operatorId = await this.clients.avsRegistryReader.getOperatorId(
            this.config.operator_address
        );
    }
}

async function main() {
	await cryptoLibInit()
	
    const configFile: string = fs.readFileSync("config-files/operator.anvil.yaml", 'utf8');
    const config: any = yaml.load(configFile, { schema: yaml.JSON_SCHEMA }) as any;
	
    const operator = new SquaringOperator(config)
	await operator.init();
	return operator.start();
}


main()
	.catch(e => console.dir(e, {depth: 6}))
	.finally(() => {
		process.exit(0)
	})
