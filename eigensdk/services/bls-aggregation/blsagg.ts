import { G1Point, G2Point, Signature } from "../../crypto/bls/attestation.js"
import * as BLS from '../../crypto/bls/attestation.js'
import { BlockNumber, OperatorId, QuorumNum, TaskIndex, Uint32, Uint8 } from "../../types/general.js"
import { bigIntCmp } from "../../utils/helpers.js"
import TimeoutPromise from "../../utils/timeout-promise.js"
import { 
	IAvsRegistryService, 
	AvsRegistryService,
	OperatorAvsState, 
	QuorumAvsState, 
	SignedTaskResponseDigest 
} from "../avsregistry/avsregistry.js"
import { AsyncQueue } from "./async-queue.js"

// BlsAggregationServiceResponse is the response from the bls aggregation service
export type BlsAggregationServiceResponse = {
	err: any,               // if Err is not nil, the other fields are not valid
	taskIndex: TaskIndex,          	// unique identifier of the task
	taskResponse: any,      			// the task response that was signed
	taskResponseDigest: string,			// digest of the task response that was signed
	// The below 8 fields are the data needed to build the IBLSSignatureChecker.NonSignerStakesAndSignature struct
	// users of this service will need to build the struct themselves by converting the bls points
	// into the BN254.G1/G2Point structs that the IBLSSignatureChecker expects
	// given that those are different for each AVS service manager that individually inherits BLSSignatureChecker
	nonSignersPubKeysG1: G1Point[],
	quorumApksG1: G1Point[],
	signersApkG2: G2Point,
	signersAggSigG1: Signature,
	nonSignerQuorumBitmapIndices: Uint32[],
	quorumApkIndices: Uint32[],
	totalStakeIndices: Uint32[]
	nonSignerStakeIndices: Uint32[][]
}

// aggregatedOperators is meant to be used as a value in a map
// map[taskResponseDigest]aggregatedOperators
export type aggregatedOperators = {
	// aggregate g2 pubkey of all operatos who signed on this taskResponseDigest
	signersApkG2: G2Point,
	// aggregate signature of all operators who signed on this taskResponseDigest
	signersAggSigG1: Signature
	// aggregate stake of all operators who signed on this header for each quorum
	signersTotalStakePerQuorum: Record<QuorumNum, bigint>,
	// set of OperatorId of operators who signed on this header
	signersOperatorIdsSet: Record<OperatorId, boolean>,
}

// BlsAggregationService is the interface provided to avs aggregator code for doing bls aggregation
// Currently its only implementation is the BlsAggregatorService, so see the comment there for more details
export interface IBlsAggregationService {
	// InitializeNewTask should be called whenever a new task is created. ProcessNewSignature will return an error
	// if the task it is trying to process has not been initialized yet.
	// quorumNumbers and quorumThresholdPercentages set the requirements for this task to be considered complete, which happens
	// when a particular TaskResponseDigest (received via the a.taskChans[taskIndex]) has been signed by signers whose stake
	// in each of the listed quorums adds up to at least quorumThresholdPercentages[i] of the total stake in that quorum
	initializeNewTask(
		taskIndex: TaskIndex,
		taskCreatedBlock: BlockNumber,
		quorumNumbers: QuorumNum[],
		quorumThresholdPercentages: Uint8[],
		timeToExpiry: number,
	): any;

	// ProcessNewSignature processes a new signature over a taskResponseDigest for a particular taskIndex by a particular operator
	// It verifies that the signature is correct and returns an error if it is not, and then aggregates the signature and stake of
	// the operator with all other signatures for the same taskIndex and taskResponseDigest pair.
	// Note: This function currently only verifies signatures over the taskResponseDigest directly, so avs code needs to verify that the digest
	// passed to ProcessNewSignature is indeed the digest of a valid taskResponse (that is, BlsAggregationService does not verify semantic integrity of the taskResponses)
	processNewSignature(
		// ctx context.Context,
		taskIndex: TaskIndex,
		taskResponse: any,
		blsSignature: Signature,
		operatorId: OperatorId,
	): any

	// GetResponseChannel returns the single channel that meant to be used as the response channel
	// Any task that is completed (see the completion criterion in the comment above InitializeNewTask)
	// will be sent on this channel along with all the necessary information to call BLSSignatureChecker onchain
	getAggregatedResponseChannel(): AsyncQueue
}

type TaskListItem = {
	taskCreatedBlock: Uint32,
	quorumNumbers: QuorumNum[],
	quorumThresholdPercentages: Uint8[],
	quorumThresholdPercentagesMap: Record<QuorumNum, Uint8>,
	operatorsAvsStateDict: Record<OperatorId, OperatorAvsState>,
	quorumsAvsStateDict: Record<QuorumNum, QuorumAvsState>,
	totalStakePerQuorum: Record<QuorumNum, bigint>
	quorumApksG1: G1Point[],
	aggregatedOperatorsDict: Object,
	timeout: number,
	promise: TimeoutPromise,
	signatures: Object,
}

type HashFunction = (input: any) => string;

export class BlsAggregationService implements IBlsAggregationService {
	avsRegistryService: IAvsRegistryService;
	aggregatedResponses: Record<TaskIndex, TaskListItem>={};
	hashFunction: HashFunction;
	aggregatedResponseChannel: AsyncQueue

	constructor(avsRegistryService: IAvsRegistryService, hashFunction: HashFunction) {
		this.avsRegistryService = avsRegistryService
		this.hashFunction = hashFunction
		this.aggregatedResponseChannel = new AsyncQueue()
	}

	async initializeNewTask(
		taskIndex: TaskIndex,
		taskCreatedBlock: BlockNumber,
		quorumNumbers: QuorumNum[],
		quorumThresholdPercentages: Uint8[],
		timeToExpiry: number,
	) {
		if(this.aggregatedResponses[taskIndex])
			throw `Task alredy initialized`

        const quorumThresholdPercentagesMap: Record<QuorumNum, Uint8> = {}
        for( let [i, qn] of quorumNumbers.entries())
            quorumThresholdPercentagesMap[qn] = quorumThresholdPercentages[i]

        const operatorsAvsStateDict = await this.avsRegistryService.getOperatorsAvsStateAtBlock(quorumNumbers, taskCreatedBlock);
        const quorumsAvsStateDict = await this.avsRegistryService.getQuorumsAvsStateAtBlock(quorumNumbers, taskCreatedBlock)

        const totalStakePerQuorum: Record<QuorumNum, bigint> = {}
        for( const quorumNum in quorumsAvsStateDict)
            totalStakePerQuorum[quorumNum] = quorumsAvsStateDict[quorumNum].totalStake

        const quorumApksG1: G1Point[] = []
        for( const [i, qn] of quorumNumbers.entries())
            quorumApksG1.push(quorumsAvsStateDict[qn].aggPubKeyG1)

        this.aggregatedResponses[taskIndex] = {
            taskCreatedBlock: taskCreatedBlock,
            quorumNumbers: quorumNumbers,
            quorumThresholdPercentages: quorumThresholdPercentages,
            quorumThresholdPercentagesMap: quorumThresholdPercentagesMap,
            operatorsAvsStateDict: operatorsAvsStateDict,
            quorumsAvsStateDict: quorumsAvsStateDict,
            totalStakePerQuorum: totalStakePerQuorum,
            quorumApksG1: quorumApksG1,
            aggregatedOperatorsDict: {},
            timeout: timeToExpiry,
            promise: new TimeoutPromise(timeToExpiry, `Task ${taskIndex} expired`),
            signatures: {},
		} as TaskListItem
	}

    async processNewSignature(taskIndex: TaskIndex, taskResponse: any, blsSignature: Signature, operatorId: OperatorId) {
        if(!this.aggregatedResponses[taskIndex])
            throw "Task not initialized"

		// @ts-ignore
        if(this.aggregatedResponses[taskIndex].signatures[operatorId])
            "Operator signature has already been processed";

        const li:TaskListItem = this.aggregatedResponses[taskIndex];
        const {operatorsAvsStateDict} = li

        const err = this.verifySignature(
            taskIndex,
            {
                taskResponse,
                blsSignature,
                operatorId,
			} as SignedTaskResponseDigest,
            operatorsAvsStateDict,
        )

        const taskResponseDigest:string = this.hashFunction(taskResponse)
		let digestAggregatedOperators: aggregatedOperators;
		// @ts-ignore
        if(!li.aggregatedOperatorsDict[taskResponseDigest]){
            digestAggregatedOperators = {
                signersApkG2: BLS.newZeroG2Point().add(
					operatorsAvsStateDict[`${operatorId}`].operatorInfo.pubKeys.g2PubKey
				),
                signersAggSigG1: blsSignature,
                signersOperatorIdsSet: {[`${operatorId}`]: true},
                signersTotalStakePerQuorum: operatorsAvsStateDict[`${operatorId}`].stakePerQuorum,
			} as aggregatedOperators;
		}
        else{
			// @ts-ignore
            digestAggregatedOperators = li.aggregatedOperatorsDict[taskResponseDigest]

            digestAggregatedOperators.signersAggSigG1 = digestAggregatedOperators.signersAggSigG1.add(blsSignature)
            digestAggregatedOperators.signersApkG2 = digestAggregatedOperators.signersApkG2.add(
                operatorsAvsStateDict[`${operatorId}`].operatorInfo.pubKeys.g2PubKey
            )
            digestAggregatedOperators.signersOperatorIdsSet[`${operatorId}`] = true
            for( const [qn, amount] of Object.entries(operatorsAvsStateDict[`${operatorId}`].stakePerQuorum)) {
				// @ts-ignore
                if (!digestAggregatedOperators.signersTotalStakePerQuorum[qn])
					// @ts-ignore
					digestAggregatedOperators.signersTotalStakePerQuorum[qn] = 0n
				// @ts-ignore
				digestAggregatedOperators.signersTotalStakePerQuorum[qn] += amount
			}
		}
        this.aggregatedResponses[taskIndex].aggregatedOperatorsDict[taskResponseDigest] = digestAggregatedOperators

        this.aggregatedResponses[taskIndex].signatures[`${operatorId}`] = blsSignature

        if(this.stakeThresholdsMet(
            digestAggregatedOperators.signersTotalStakePerQuorum,
            li.totalStakePerQuorum,
            li.quorumThresholdPercentagesMap,
        )){
            const nonSignersOperatorIds: OperatorId[] = []
            for(const operatorId in operatorsAvsStateDict)
                if (!digestAggregatedOperators.signersOperatorIdsSet[`${operatorId}`])
                    nonSignersOperatorIds.push(operatorId)
            nonSignersOperatorIds.sort(bigIntCmp)

            const nonSignersPubKeysG1: G1Point[] = nonSignersOperatorIds.map(id => operatorsAvsStateDict[`${id}`].operatorInfo.pubKeys.g1PubKey)

            // let indices = await this.avsRegistryService.getCheckSignaturesIndices(
            //     {},
            //     li.taskCreatedBlock,
            //     li.quorumNumbers,
            //     nonSignersOperatorIds,
            // )
			let indices = await this.avsRegistryService.getCheckSignaturesIndices(
				{},
				li.taskCreatedBlock,
				li.quorumNumbers,
				nonSignersOperatorIds,
			)

            let result = {
                err: undefined,
                taskIndex,
                taskResponse,
                taskResponseDigest,
                nonSignersPubKeysG1,
                quorumApksG1: li.quorumApksG1,
                signersApkG2: digestAggregatedOperators.signersApkG2,
                signersAggSigG1: digestAggregatedOperators.signersAggSigG1,
                ...indices
			} as BlsAggregationServiceResponse;

            this.aggregatedResponses[taskIndex].promise.resolve(result)
			await this.aggregatedResponseChannel.enqueue(result)
		}
	}

	getAggregatedResponseChannel(): AsyncQueue {
        // return await wait_for(self.aggregated_responses_c[task_index].future)
		return this.aggregatedResponseChannel;
	}

	async getAggregatedResponse(taskIndex: TaskIndex) {
        try{
            const result = await this.aggregatedResponses[taskIndex].promise.waitToFulfill();
            return result
		}
		catch(err) {
			// @ts-ignore
            return {err}
		}
	}

    private stakeThresholdsMet(
        signedStakePerQuorum: Record<QuorumNum, bigint>,
        totalStakePerQuorum: Record<QuorumNum, bigint>,
        quorumThresholdPercentagesMap: Record<QuorumNum, Uint8>,
    ): boolean {
        for(const [quorumNum, quorumThresholdPercentage] of Object.entries(quorumThresholdPercentagesMap)) {
            const signedStakeByQuorum = signedStakePerQuorum[quorumNum]
            if(signedStakeByQuorum == undefined)
                return false
            const totalStakeByQuorum:bigint = totalStakePerQuorum[quorumNum]
            if(totalStakeByQuorum == undefined)
                return false
            const signedStake:bigint = signedStakeByQuorum * 100n
			// @ts-ignore
            const thresholdStake:bigint = totalStakeByQuorum * BigInt(quorumThresholdPercentage)
            if(signedStake < thresholdStake)
                return false
		}
        return true
	}

    private verifySignature(
        taskIndex: TaskIndex,
        signedTaskResponseDigest: SignedTaskResponseDigest,
        operatorsAvsStateDict: Record<string, OperatorAvsState>,
    ){
        const operatorId:string = `${signedTaskResponseDigest.operatorId}`

        if(!operatorsAvsStateDict[operatorId])
            return `Operator ${operatorId} is not part of task quorum`

        const taskResponseDigest = this.hashFunction(signedTaskResponseDigest.taskResponse)

        const operatorG2PubKey = operatorsAvsStateDict[operatorId].operatorInfo.pubKeys.g2PubKey
        if(!operatorG2PubKey)
            return `TaskId: ${taskIndex} operator G2 PubKey not fount for operator ${operatorId}`

        const signature = signedTaskResponseDigest.blsSignature
        const verified = signature.verify(operatorG2PubKey, taskResponseDigest)
        if(!verified)
            return "Incorrect signature error"

        return;
	}
}