import { AvsRegistryReader } from "../../chainio/clients/avsregistry/reader"
import { G1Point, G2Point, Signature, newZeroG1Point } from "../../crypto/bls/attestation"
import { BlockNumber, OperatorId, QuorumNum, Uint32, Uint8 } from '../../types/general'
import { Address } from "web3"
import { Logger } from 'pino';
import { OperatorsInfoServiceInMemory } from "../operatorsinfo/operatorsinfo-inmemory"


export type OperatorPubkeys = {
    // G1 signatures are used to verify signatures onchain (since G1 is cheaper to verify onchain via precompiles)
    g1PubKey: G1Point,
	// G2 is used to verify signatures offchain (signatures are on G1)
    g2PubKey: G2Point,

}

export type Operator = {
    address: Address,
    earningsReceiverAddress: Address, // default: ""
    delegationApproverAddress: Address, // default: ""
    stakerOptOutWindowBlocks?: number,
    metadataUrl: string, // default: ""
}

export type OperatorStateRetrieverOperator = {
    operator: Address,
    operatorId: OperatorId,
    stake: bigint,
}

export type OperatorInfo = {
    socket: string,
    pubKeys: OperatorPubkeys,
}

export type OperatorAvsState = {
    operatorId: OperatorId,
    operatorInfo: OperatorInfo,
    // Stake of the operator for each quorum
    stakePerQuorum: Record<Uint8, bigint>,
    blockNumber: Uint32,
}

export type QuorumAvsState = {
    quorumNumber: Uint8,
    totalStake: bigint,
    aggPubKeyG1: G1Point,
    blockNumber: Uint32,
}

export type CallOpts = {
    // Whether to operate on the pending state or the last known one
    pending?: boolean,
    // Optional the sender address, otherwise the first account is used
    fromAddress?: string,
    // Optional the block number on which the call should be performed
    blockNumber?: Uint32,
    // Optional the block hash on which the call should be performed
    blockHash?: string,
}

export type OperatorStateRetrieverCheckSignaturesIndices = {
    nonSignerQuorumBitmapIndices: Uint32[],
    quorumApkIndices: Uint32[],
    totalStakeIndices: Uint32[],
    nonSignerStakeIndices: Uint32[][],
}

export type SignedTaskResponseDigest = {
    taskResponse: any,
    blsSignature: Signature,
    operatorId: OperatorId,
}

export interface IAvsRegistryService {
    /**
    all the moethods support cancellation through what is called a Context in Go.
    The GetCheckSignaturesIndices should support Context inside CallOpts data class
    **/

    getOperatorsAvsStateAtBlock (
		quorumNumbers: QuorumNum[], 
		blockNumber: BlockNumber
	): Promise<Record<OperatorId, OperatorAvsState>>;

    getQuorumsAvsStateAtBlock (
        quorumNumbers: QuorumNum[], 
		blockNumber: BlockNumber
    ): Promise<Record<QuorumNum, QuorumAvsState>>;

    // getCheckSignaturesIndices (
    //     opts: CallOpts,
    //     referenceBlockNumber: BlockNumber,
    //     quorumNumbers: QuorumNum[],
    //     nonSignerOperatorIds: bigint[]
    // ): Promise<OperatorStateRetrieverCheckSignaturesIndices>;
}

export class AvsRegistryService implements IAvsRegistryService {
    avsRegistryReader: AvsRegistryReader;
    operatorInfoService: OperatorsInfoServiceInMemory;
    logger: Logger;

    constructor(
        avsRegistryReader: AvsRegistryReader,
        operatorInfoService: OperatorsInfoServiceInMemory,
        logger: Logger
    ) {
        this.avsRegistryReader = avsRegistryReader;
        this.operatorInfoService = operatorInfoService;
        this.logger = logger;
    }

    public async getOperatorsAvsStateAtBlock(
        quorumNumbers: number[],
        blockNumber: number
    ): Promise<Record<string, OperatorAvsState>> {
        const operatorsAvsState: Record<OperatorId, OperatorAvsState> = {};

        const operatorsStakesInQuorums = await this.avsRegistryReader.getOperatorsStakeInQuorumsAtBlock(
            quorumNumbers,
            blockNumber
        );

        const numQuorums = quorumNumbers.length;
        if (operatorsStakesInQuorums.length !== numQuorums) {
            this.logger.error(
                'Number of quorums returned from getOperatorsStakeInQuorumsAtBlock does not match number of quorums requested. Probably pointing to old contract or wrong implementation.',
                { service: 'AvsRegistryServiceChainCaller' }
            );
        }

        for(let [quorumIdx, quorum] of Object.entries(operatorsStakesInQuorums)) {
			// @ts-ignore
            const quorumNum = quorumNumbers[quorumIdx];
            for(let operator of quorum) {
                let info: OperatorInfo;
                try {
                    info = await this.getOperatorInfo(operator.operatorId);
                } catch {
                    this.logger.error(`Operator ${operator.operatorId} info not found. The operator is skipped.`);
                    continue;
                }

                if (!operatorsAvsState[operator.operatorId]) {
                    operatorsAvsState[operator.operatorId] = {
                        operatorId: operator.operatorId,
                        operatorInfo: info,
                        stakePerQuorum: {},
                        blockNumber: blockNumber
                    };
                }

                const operatorState = operatorsAvsState[operator.operatorId];
                operatorState.stakePerQuorum[quorumNum] = operator.stake;
            };
        };

        return operatorsAvsState;
    }

    public async getQuorumsAvsStateAtBlock(
        quorumNumbers: QuorumNum[],
        blockNumber: BlockNumber
    ): Promise<Record<QuorumNum, QuorumAvsState>> {
        const operatorsAvsState = await this.getOperatorsAvsStateAtBlock(
            quorumNumbers,
            blockNumber
        );

        const quorumsAvsState: Record<QuorumNum, QuorumAvsState> = {};

    	for ( let quorumNum of quorumNumbers ) {
            let aggPubkeyG1 = newZeroG1Point();
            let totalStake = 0n;

            for ( let [_, operatorState] of Object.entries(operatorsAvsState) ) {
                if (operatorState.stakePerQuorum.hasOwnProperty(quorumNum)) {
                    aggPubkeyG1 = aggPubkeyG1.add(
                        operatorState.operatorInfo.pubKeys.g1PubKey
                    );
                    const stake = operatorState.stakePerQuorum[quorumNum];
                    totalStake += stake;
                }
            };

            quorumsAvsState[quorumNum] = {
                quorumNumber: quorumNum,
                aggPubKeyG1: aggPubkeyG1,
                totalStake: totalStake,
                blockNumber: blockNumber
            } as QuorumAvsState;
        };

        return quorumsAvsState;
    }

    // async getCheckSignaturesIndices (
    //     opts: CallOpts,
    //     referenceBlockNumber: BlockNumber,
    //     quorumNumbers: QuorumNum[],
    //     nonSignerOperatorIds: bigint[]
    // ): Promise<OperatorStateRetrieverCheckSignaturesIndices> {
	// 	// TODO: fill with contract data
	// 	return {
	// 		nonSignerQuorumBitmapIndices: [],
	// 		quorumApkIndices: [],
	// 		totalStakeIndices: [],
	// 		nonSignerStakeIndices: []
	// 	} as OperatorStateRetrieverCheckSignaturesIndices
	// }

    private async getOperatorInfo(operatorId: OperatorId): Promise<OperatorInfo> {
        const operatorAddr = await this.avsRegistryReader.getOperatorFromId(operatorId);
        return this.operatorInfoService.getOperatorInfo(operatorAddr);
    }
}