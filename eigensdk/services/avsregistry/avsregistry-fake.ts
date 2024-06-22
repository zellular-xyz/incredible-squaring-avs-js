import { G1Point, KeyPair } from "../../crypto/bls/attestation.js"
import { BlockNumber, OperatorId, QuorumNum, Uint32, Uint8 } from "../../types/general.js"
import { 
	IAvsRegistryService, 
	CallOpts, 
	OperatorAvsState, 
	OperatorInfo,
	OperatorPubkeys,
	OperatorStateRetrieverCheckSignaturesIndices,
	QuorumAvsState
} from "./avsregistry.js"
import * as mcl from 'mcl-wasm'


export type TestOperator = {
    operatorId: OperatorId
    stakePerQuorum: Record<Uint8, bigint>
    blsKeyPair: KeyPair
}

export class FakeAvsRegistryService implements IAvsRegistryService {
    operators: Record<string, Record<string, OperatorAvsState>>

    constructor( blockNumber: Uint32, operators: TestOperator[]) {
        this.operators = {[blockNumber]: {}};
        for(let operator of operators) {
            this.operators[blockNumber][`${operator.operatorId}`] = {
                operatorId: operator.operatorId,
                operatorInfo: {
                    socket: "localhost:9090",
                    pubKeys: {
                        g1PubKey: operator.blsKeyPair.pubG1,
                        g2PubKey: operator.blsKeyPair.pubG2,
					 } as OperatorPubkeys,
				} as OperatorInfo,
                stakePerQuorum: operator.stakePerQuorum,
                blockNumber: blockNumber,
			} as OperatorAvsState;
		}
	}

    async getOperatorsAvsStateAtBlock(
        quorumNumbers: Uint8[], blockNumber: Uint32
    ): Promise<Record<string, OperatorAvsState>> {
        if(!this.operators[blockNumber])
            throw `No data for the block ${blockNumber}`
        return this.operators[blockNumber]
	}

    async getQuorumsAvsStateAtBlock(
        quorumNumbers: Uint8[], blockNumber: Uint32
    ): Promise<Record<Uint8, QuorumAvsState>> {
        if(!this.operators[blockNumber])
            throw `No data for the block ${blockNumber}`
        const state:Record<Uint8, QuorumAvsState> = {}
        for(let qn of quorumNumbers) {
            let aggPubKeyG1: G1Point = new G1Point(0n, 0n);
            let totalStake = 0n
            for(let [operatorId, operatorAvsState] of Object.entries(this.operators[blockNumber])) {
                aggPubKeyG1 = aggPubKeyG1.add(operatorAvsState.operatorInfo.pubKeys.g1PubKey)
                totalStake = totalStake + operatorAvsState.stakePerQuorum[qn]
			}
            state[qn] = {
                quorumNumber: qn,
                totalStake: totalStake,
                aggPubKeyG1: aggPubKeyG1,
                blockNumber: blockNumber,
			 } as QuorumAvsState
		}
        return state
	}

    async getCheckSignaturesIndices(
        opts: CallOpts,
        referenceBlockNumber: BlockNumber,
        quorumNumbers: QuorumNum[],
        nonSignerOperatorIds: OperatorId[],
    ): Promise<OperatorStateRetrieverCheckSignaturesIndices> {
        const result = {
            nonSignerQuorumBitmapIndices: [],
            quorumApkIndices:[],
            totalStakeIndices:[],
            nonSignerStakeIndices:[],
		 } as OperatorStateRetrieverCheckSignaturesIndices;
        return result
	}
}