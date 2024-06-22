import { Address, Contract, Web3 } from 'web3';
import {Logger} from 'pino'
import * as ABIs from '../../../contracts/ABIs'
import * as chainioUtils from '../../utils'
import { OperatorPubkeys, OperatorStateRetrieverCheckSignaturesIndices, OperatorStateRetrieverOperator } from '../../../services/avsregistry/avsregistry.js';
import { BlockNumber, OperatorId, QuorumNum, Uint8 } from '../../../types/general';
import { G1Point, G2Point } from '../../../crypto/bls/attestation';

const DEFAULT_QUERY_BLOCK_RANGE = 10_000

export class AvsRegistryReader {
    private logger: Logger;
    private blsApkRegistryAddr: Address;
    private blsApkRegistry: Contract<typeof ABIs.BLS_APK_REGISTRY>;
    private registryCoordinatorAddr: Address;
    private registryCoordinator: Contract<typeof ABIs.REGISTRY_COORDINATOR>;
    private operatorStateRetriever: Contract<typeof ABIs.OPERATOR_STATE_RETRIEVER>;
    private stakeRegistry: Contract<typeof ABIs.STAKE_REGISTRY>;
    ethHttpClient: Web3;

    constructor(
        registryCoordinatorAddr: Address,
        registryCoordinator: Contract<typeof ABIs.REGISTRY_COORDINATOR>,
        blsApkRegistryAddr: Address,
        blsApkRegistry: Contract<typeof ABIs.BLS_APK_REGISTRY>,
        operatorStateRetriever: Contract<typeof ABIs.OPERATOR_STATE_RETRIEVER>,
        stakeRegistry: Contract<typeof ABIs.STAKE_REGISTRY>,
        logger: Logger,
        ethHttpClient: Web3,
    ) {
        this.logger = logger;
        this.blsApkRegistryAddr = blsApkRegistryAddr;
        this.blsApkRegistry = blsApkRegistry;
        this.registryCoordinatorAddr = registryCoordinatorAddr;
        this.registryCoordinator = registryCoordinator;
        this.operatorStateRetriever = operatorStateRetriever;
        this.stakeRegistry = stakeRegistry;
        this.ethHttpClient = ethHttpClient;
    }

    async getQuorumCount(): Promise<number> {
        return await this.registryCoordinator.methods.quorumCount().call();
    }

    async getOperatorsStakeInQuorumsAtCurrentBlock(quorumNumbers: Uint8[]): Promise<OperatorStateRetrieverOperator[][]> {
        const curBlock = await this.ethHttpClient.eth.getBlockNumber();
        if (curBlock > Math.pow(2, 32) - 1) {
            throw new Error("Current block number is too large to be converted to uint32");
        }
        return await this.getOperatorsStakeInQuorumsAtBlock(quorumNumbers, Number(curBlock));
    }

    async getOperatorsStakeInQuorumsAtBlock(quorumNumbers: Uint8[], blockNumber: number): Promise<OperatorStateRetrieverOperator[][]> {
        const operatorStakes = await this.operatorStateRetriever.methods.getOperatorState(
            this.registryCoordinatorAddr,
            chainioUtils.numsToBytes(quorumNumbers),
            blockNumber
        ).call();
		if(!operatorStakes)
			return [];
        return operatorStakes.map((quorum: any) => 
            quorum.map((operator: any) => ({
                operator: operator[0],
                operatorId: operator[1],
                stake: operator[2]
            }))
        );
    }

    async getOperatorAddrsInQuorumsAtCurrentBlock(quorumNumbers: Uint8[]): Promise<Address[][]> {
        const curBlock = await this.ethHttpClient.eth.getBlockNumber();
        if (curBlock > Math.pow(2, 32) - 1) {
            throw new Error("Current block number is too large to be converted to uint32");
        }

        const operatorStakes = await this.operatorStateRetriever.methods.getOperatorState(
            this.registryCoordinatorAddr,
            chainioUtils.numsToBytes(quorumNumbers),
            curBlock
        ).call();
		if(!operatorStakes)
			return []
        return operatorStakes.map((quorum: any) => 
            quorum.map((operator: any) => operator[0])
        );
    }

    async getOperatorsStakeInQuorumsOfOperatorAtBlock(operatorId: OperatorId, blockNumber: number): Promise<[number[], OperatorStateRetrieverOperator[][]]> {
        const result:[number, number[]] = await this.operatorStateRetriever.methods.getOperatorState(
            this.registryCoordinatorAddr,
            operatorId,
            blockNumber
        ).call();
		if(!result)
			return [[], []]
		const [quorumBitmap, operatorStakes] = result;

        const quorums = chainioUtils.bitmapToQuorumIds(quorumBitmap);
        const operatorStakesFormatted = operatorStakes.map((quorum: any) => 
            quorum.map((operator: any) => ({
                operator: operator[0],
                operatorId: operator[1],
                stake: operator[2]
            }))
        );

        return [quorums, operatorStakesFormatted];
    }

    async getOperatorsStakeInQuorumsOfOperatorAtCurrentBlock(operatorId: OperatorId): Promise<[number[], OperatorStateRetrieverOperator[][]]> {
        const curBlock = await this.ethHttpClient.eth.getBlockNumber();
        if (curBlock > Math.pow(2, 32) - 1) {
            throw new Error("Current block number is too large to be converted to uint32");
        }
        return this.getOperatorsStakeInQuorumsOfOperatorAtBlock(operatorId, Number(curBlock));
    }

    async getOperatorStakeInQuorumsOfOperatorAtCurrentBlock(operatorId: OperatorId): Promise<Record<number, bigint>> {
        const quorumBitmap:number = await this.registryCoordinator.methods.getCurrentQuorumBitmap(operatorId).call();
        const quorums = chainioUtils.bitmapToQuorumIds(quorumBitmap);
        const quorumStakes: Record<number, bigint> = {};
        for (const quorum of quorums) {
            const stake:bigint = await this.stakeRegistry.methods.getCurrentStake(operatorId, quorum).call();
            quorumStakes[quorum] = stake;
        }
        return quorumStakes;
    }

    async getCheckSignaturesIndices(
        referenceBlockNumber: BlockNumber,
        quorumNumbers: QuorumNum[],
        nonSignerOperatorIds: OperatorId[]
    ): Promise<OperatorStateRetrieverCheckSignaturesIndices> {
        const nonSignerOperatorIdsBytes = nonSignerOperatorIds.map(operatorId => 
            Buffer.from(operatorId, 'hex')
        );
        const checkSignatureIndices = await this.operatorStateRetriever.methods.getCheckSignaturesIndices(
            this.registryCoordinatorAddr,
            referenceBlockNumber,
            chainioUtils.numsToBytes(quorumNumbers),
            nonSignerOperatorIdsBytes
        ).call();

		if(!checkSignatureIndices)
			throw `Unable to get signature check indices`

        return {
            nonSignerQuorumBitmapIndices: checkSignatureIndices[0],
            quorumApkIndices: checkSignatureIndices[1],
            totalStakeIndices: checkSignatureIndices[2],
            nonSignerStakeIndices: checkSignatureIndices[3],
        };
    }

    async getOperatorId(operatorAddress: Address): Promise<OperatorId> {
        return await this.registryCoordinator.methods.getOperatorId(operatorAddress).call();
    }

    async getOperatorFromId(operatorId: OperatorId): Promise<Address> {
        return this.registryCoordinator.methods.getOperatorFromId(operatorId).call();
    }

    async isOperatorRegistered(operatorAddress: Address): Promise<boolean> {
        const operatorStatus:number = await this.registryCoordinator.methods.getOperatorStatus(operatorAddress).call();
        return operatorStatus === 1;
    }

    async queryExistingRegisteredOperatorPubkeys(
        startBlock: number = 0,
        stopBlock?: number,
        blockRange: number = DEFAULT_QUERY_BLOCK_RANGE
    ): Promise<[Address[], OperatorPubkeys[], number]> {
        if (stopBlock === undefined) {
            stopBlock = Number(await this.ethHttpClient.eth.getBlockNumber());
        }

        const operatorPubkeys: OperatorPubkeys[] = [];
        const operatorAddresses: Address[] = [];
        let toBlock: number = startBlock;

        for (let i = startBlock; i <= stopBlock; i += blockRange) {
            toBlock = Math.min(i + blockRange - 1, stopBlock);
			// @ts-ignore
            const pubkeyUpdates = await this.blsApkRegistry.events.NewPubkeyRegistration.createFilter({
                fromBlock: i,
                toBlock: toBlock
            }).getAllEntries();

            this.logger.debug(
                "avsRegistryChainReader.query_existing_registered_operator_pubkeys",
                {
                    numTransactionLogs: pubkeyUpdates.length,
                    fromBlock: i,
                    toBlock: toBlock,
                }
            );

            for (const update of pubkeyUpdates) {
                const operatorAddr = update.args.operator;
                const pubkeyG1 = update.args.pubkeyG1;
                const pubkeyG2 = update.args.pubkeyG2;
                operatorPubkeys.push({
                    // g1PubKey: { X: pubkeyG1.X, Y: pubkeyG1.Y },
                    g1PubKey: new G1Point(BigInt(pubkeyG1.Y), BigInt(pubkeyG1.Y)),
                    // g2PubKey: { X: pubkeyG2.X, Y: pubkeyG2.Y },
                    g2PubKey: new G2Point(
						BigInt(pubkeyG1.X[0]), BigInt(pubkeyG1.X[1]),
						BigInt(pubkeyG1.Y[0]), BigInt(pubkeyG1.Y[1]),
					),
                });
                operatorAddresses.push(operatorAddr);
            }
        }

        return [operatorAddresses, operatorPubkeys, toBlock];
    }

    async queryExistingRegisteredOperatorSockets(
        startBlock: number = 0,
        stopBlock?: number,
        blockRange: number = DEFAULT_QUERY_BLOCK_RANGE
    ): Promise<[Record<string, string>, number]> {
        if (stopBlock === undefined) {
            stopBlock = Number(await this.ethHttpClient.eth.getBlockNumber());
        }

        const operatorIdToSocketMap: Record<string, string> = {};
        let toBlock: number = startBlock;

        for (let i = startBlock; i <= stopBlock; i += blockRange) {
            toBlock = Math.min(i + blockRange - 1, stopBlock);
			// @ts-ignore
            const socketUpdates = await this.registryCoordinator.events.OperatorSocketUpdate.createFilter({
                fromBlock: i,
                toBlock: toBlock
            }).getAllEntries();

            let numSocketUpdates = 0;
            for (const update of socketUpdates) {
                operatorIdToSocketMap[update.args.operatorId] = update.args.socket;
                numSocketUpdates += 1;
            }

            this.logger.debug(
                "avsRegistryChainReader.query_existing_registered_operator_sockets",
                {
                    numTransactionLogs: numSocketUpdates,
                    fromBlock: i,
                    toBlock: toBlock,
                }
            );
        }

        return [operatorIdToSocketMap, toBlock];
    }
}