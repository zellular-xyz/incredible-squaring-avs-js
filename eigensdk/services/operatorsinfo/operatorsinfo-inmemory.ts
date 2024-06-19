import { Web3, Contract, AbiItem, Address } from 'web3';
import { keccak256, toHex } from 'web3-utils';
import { Logger, pino } from 'pino';
// import { G1Point, AvsRegistryReader, OperatorPubkeys, Address, OperatorInfo } from './types'; // Adjust the import according to your actual types
// import { Thread } from 'threads';
import { AvsRegistryReader } from '../../chainio/clients/avsregistry/reader.js';
import { OperatorInfo, OperatorPubkeys } from '../avsregistry/avsregistry.js';
import { G1Point } from '../../crypto/bls/attestation.js';

interface OperatorsInfoServiceInMemoryOptions {
    startBlockPub?: number;
    startBlockSocket?: number;
    checkInterval?: number;
    logFilterQueryBlockRange?: number;
    logger?: Logger;
}

class OperatorsInfoServiceInMemory {
    private avsRegistryReader: AvsRegistryReader;
    private startBlockPub: number;
    private startBlockSocket: number;
    private checkInterval: number;
    private logFilterQueryBlockRange: number;
    private logger: Logger;
    private ethHttpClient: Web3;
    private pubkeyDict: Map<string, OperatorPubkeys>;
    private operatorAddrToId: Map<Address, string>;
    private socketDict: Map<string, string>;
    // private thread: Thread;

    constructor(
        avsRegistryReader: AvsRegistryReader,
        options: OperatorsInfoServiceInMemoryOptions = {}
    ) {
        const {
            startBlockPub = 0,
            startBlockSocket = 0,
            checkInterval = 10,
            logFilterQueryBlockRange = 10_000,
            logger = pino({
                level: 'info',
                transport: {
					target: 'pino-pretty'
				},
            }),
        } = options;

        this.avsRegistryReader = avsRegistryReader;
        this.startBlockPub = startBlockPub;
        this.startBlockSocket = startBlockSocket;
        this.checkInterval = checkInterval;
        this.logFilterQueryBlockRange = logFilterQueryBlockRange;
        this.logger = logger;
        this.ethHttpClient = avsRegistryReader.ethHttpClient;

        this.pubkeyDict = new Map<string, OperatorPubkeys>();
        this.operatorAddrToId = new Map<Address, string>();
        this.socketDict = new Map<string, string>();

        this.getEvents();
        // this.thread = new Thread(this._serviceThread.bind(this));
        // this.thread.start();

		this._serviceThread()
			.catch(e => {})
    }

    private static operatorIdFromG1Pubkey(g1: G1Point): string {
        const xBytes = Web3.utils.hexToBytes(g1.getX().getStr(16).padStart(64, '0'));
        const yBytes = Web3.utils.hexToBytes(g1.getY().getStr(16).padStart(64, '0'));
        const concatenated = new Uint8Array([...xBytes, ...yBytes]);
        return keccak256(concatenated);
    }

    private async _serviceThread(): Promise<void> {
        while (true) {
            try {
                await this.getEvents();
            } catch (e) {
                this.logger.error(`Get event Error: ${e}`);
            }
            await new Promise(resolve => setTimeout(resolve, this.checkInterval * 1000));
        }
    }

    private async getEvents(): Promise<void> {
        const [ 
			operatorAddresses, operatorPubkeys, toBlockPub 
		 ] = await this.avsRegistryReader.queryExistingRegisteredOperatorPubkeys(
            this.startBlockPub
        );

        const [
			operatorSockets, toBlockSocket 
		] = await this.avsRegistryReader.queryExistingRegisteredOperatorSockets(this.startBlockSocket);

        for (let i = 0; i < operatorAddresses.length; i++) {
            const operatorAddr = operatorAddresses[i];
            const operatorPubkey = operatorPubkeys[i];
            const operatorId = OperatorsInfoServiceInMemory.operatorIdFromG1Pubkey(operatorPubkey.g1PubKey);
            this.pubkeyDict.set(operatorId, operatorPubkey);
            this.operatorAddrToId.set(operatorAddr, operatorId);
        }

        for (const [operatorId, socket] of Object.entries(operatorSockets)) {
            this.socketDict.set(operatorId, socket);
        }

        this.logger.debug(`Queried operator registration events: ${operatorPubkeys}`);

        this.startBlockPub = toBlockPub;
        this.startBlockSocket = toBlockSocket;
    }

    public getOperatorInfo(operatorAddr: Address): OperatorInfo {
        const operatorId = this.operatorAddrToId.get(operatorAddr);
        if (!operatorId) {
            throw new Error("Not found");
        }
        return {
            socket: this.socketDict.get(operatorId)!,
            pubKeys: this.pubkeyDict.get(operatorId)!
        };
    }
}
