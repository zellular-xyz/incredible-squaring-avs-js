import { expect, test, beforeAll } from 'vitest';
import * as bn254Utils from '../../crypto/bn254/utils.js'
import * as ethers from 'ethers';
import { FakeAvsRegistryService, TestOperator } from '../avsregistry/avsregistry-fake.js'
import { G1Point, KeyPair } from "../../crypto/bls/attestation.js"
import { BlsAggregationService, BlsAggregationServiceResponse } from './blsagg.js';

function hashFunction(input: string): string {
	return ethers.keccak256(Buffer.from(input));
}

function delay(ms: number): Promise<any> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function runDelayed(ms: number, instance: any, method: string, ...args: any[]){
	await delay(ms);
	return instance[method](args)
}

beforeAll(async () => {
	await bn254Utils.init();
})

const TIME_TO_EXPIRE_TASK = 3000

function isResponseSerializable(res): boolean {
	try {
		JSON.stringify(res);
		return true
	}
	catch{
		return false;
	}
}

function stringifyAggResp(resp: BlsAggregationServiceResponse): string {
	if(!isResponseSerializable(resp.taskResponse))
		throw `Task response is not JSON serializable.`

	let dict: Object = resp.err
	?
	{err: resp.err}
	:
	{
		taskIndex: resp.taskIndex,
		taskResponse: resp.taskResponse,
		taskResponseDigest: resp.taskResponseDigest,
		nonSignersPubKeysG1: resp.nonSignersPubKeysG1.map(p => p.getStr()),
		quorumApksG1: resp.quorumApksG1.map(p => p.getStr()),
		signersApkG2: resp.signersApkG2.getStr(),
		signersAggSigG1: resp.signersAggSigG1.getStr(),
		nonSignerQuorumBitmapIndices: resp.nonSignerQuorumBitmapIndices,
		quorumApkIndices: resp.quorumApkIndices,
		totalStakeIndices: resp.totalStakeIndices,
		nonSignerStakeIndices: resp.nonSignerStakeIndices,
	}
	return JSON.stringify(dict);
}

test("1 quorum 1 operator 1 correct signature", async () => {

	const taskIndex = 1
	const blockNumber = 1
	const taskResponse = "sample text response"
	const taskResponseDigest = hashFunction(taskResponse)
	const operator1:TestOperator = {
		operatorId: 1n,
		stakePerQuorum: {1: 100n, 2: 200n},
		blsKeyPair: KeyPair.fromString("01"),
	}

	const blsSign = operator1.blsKeyPair.signMessage(taskResponseDigest)
	const fakeAvsRegistryService = new FakeAvsRegistryService(blockNumber, [operator1])

	const blsAggregationService = new BlsAggregationService(
		fakeAvsRegistryService,
		hashFunction,
	)

	await blsAggregationService.initializeNewTask(taskIndex, blockNumber, [1], [100], TIME_TO_EXPIRE_TASK)

	blsAggregationService.processNewSignature(taskIndex, taskResponse, blsSign, operator1.operatorId)
		.catch(e => console.log(e))

	const wantAggregatedResponse = {
		err: undefined,
		taskIndex,
		taskResponse,
		taskResponseDigest,
		nonSignersPubKeysG1: [],
		quorumApksG1: [operator1.blsKeyPair.pubG1],
		signersApkG2: operator1.blsKeyPair.pubG2,
		signersAggSigG1: blsSign,
		nonSignerQuorumBitmapIndices: [],
		quorumApkIndices: [],
		totalStakeIndices: [],
		nonSignerStakeIndices: [],
	} as BlsAggregationServiceResponse;

	const gotAggregatedResponse = await blsAggregationService.getAggregatedResponse(taskIndex)
	
	expect(stringifyAggResp(wantAggregatedResponse))
	.to.equal(stringifyAggResp(gotAggregatedResponse))
})

test("1 quorum 3 operator 3 correct signatures", async () => {

	const operator1:TestOperator = {
		operatorId: 1n,
		stakePerQuorum: {1: 100n, 2: 200n},
		blsKeyPair: KeyPair.fromString("01"),
	}
	const operator2:TestOperator = {
		operatorId: 2n,
		stakePerQuorum: {1: 100n, 2: 200n},
		blsKeyPair: KeyPair.fromString("02"),
	}
	const operator3:TestOperator = {
		operatorId: 3n,
		stakePerQuorum: {1: 100n, 2: 200n},
		blsKeyPair: KeyPair.fromString("03"),
	}

	const blockNumber = 1
	const taskIndex = 1
	const quorumNumbers = [1]
	const quorumThresholdPercentages = [100]
	const taskResponse = "sample text response for tast case 2"
	const taskResponseDigest = hashFunction(taskResponse)
	
	const fakeAvsRegistryService = new FakeAvsRegistryService(blockNumber, [operator1, operator2,operator3])
	const blsAggregationService = new BlsAggregationService(
		fakeAvsRegistryService,
		hashFunction,
	)

	await blsAggregationService.initializeNewTask(taskIndex, blockNumber, quorumNumbers, quorumThresholdPercentages, TIME_TO_EXPIRE_TASK)

	const blsSign1 = operator1.blsKeyPair.signMessage(taskResponseDigest)
	blsAggregationService.processNewSignature(taskIndex, taskResponse, blsSign1, operator1.operatorId)
		.catch(e => console.log(e))

	const blsSign2 = operator2.blsKeyPair.signMessage(taskResponseDigest)
	blsAggregationService.processNewSignature(taskIndex, taskResponse, blsSign2, operator2.operatorId)
		.catch(e => console.log(e))

	const blsSign3 = operator3.blsKeyPair.signMessage(taskResponseDigest)
	blsAggregationService.processNewSignature(taskIndex, taskResponse, blsSign3, operator3.operatorId)
		.catch(e => console.log(e))

	const wantAggregatedResponse = {
		err: undefined,
		taskIndex,
		taskResponse,
		taskResponseDigest,
		nonSignersPubKeysG1: [],
		quorumApksG1: [
			operator1.blsKeyPair.pubG1
			.add(operator2.blsKeyPair.pubG1)
			.add(operator3.blsKeyPair.pubG1)
		],
		signersApkG2: operator1.blsKeyPair.pubG2
			.add(operator2.blsKeyPair.pubG2)
			.add(operator3.blsKeyPair.pubG2),
		signersAggSigG1: blsSign1.add(blsSign2).add(blsSign3),
		nonSignerQuorumBitmapIndices: [],
		quorumApkIndices: [],
		totalStakeIndices: [],
		nonSignerStakeIndices: [],
	} as BlsAggregationServiceResponse;

	const gotAggregatedResponse = await blsAggregationService.getAggregatedResponse(taskIndex)

	expect(stringifyAggResp(wantAggregatedResponse))
	.to.equal(stringifyAggResp(gotAggregatedResponse))
})

test("2 quorums 2 operators 2 correct signatures", async () => {
	const operator1:TestOperator = {
		operatorId: 1n,
		stakePerQuorum: {1: 100n, 2: 200n},
		blsKeyPair: KeyPair.fromString("01"),
	}
	const operator2:TestOperator = {
		operatorId: 2n,
		stakePerQuorum: {1: 100n, 2: 200n},
		blsKeyPair: KeyPair.fromString("02"),
	}

	const blockNumber = 1
	const taskIndex = 1
	const quorumNumbers = [1, 2]
	const quorumThresholdPercentages = [100, 100]
	const taskResponse = "sample text response for tast case 3"
	const taskResponseDigest = hashFunction(taskResponse)
	
	const fakeAvsRegistryService = new FakeAvsRegistryService(blockNumber, [operator1, operator2])
	const blsAggregationService = new BlsAggregationService(
		fakeAvsRegistryService,
		hashFunction,
	)

	await blsAggregationService.initializeNewTask(taskIndex, blockNumber, quorumNumbers, quorumThresholdPercentages, TIME_TO_EXPIRE_TASK)

	const blsSign1 = operator1.blsKeyPair.signMessage(taskResponseDigest)
	blsAggregationService.processNewSignature(taskIndex, taskResponse, blsSign1, operator1.operatorId)
		.catch(e => console.log(e));

	const blsSign2 = operator2.blsKeyPair.signMessage(taskResponseDigest)
	blsAggregationService.processNewSignature(taskIndex, taskResponse, blsSign2, operator2.operatorId)
		.catch(e => console.log(e));

	const wantAggregatedResponse = {
		err: undefined,
		taskIndex,
		taskResponse,
		taskResponseDigest,
		nonSignersPubKeysG1: [],
		quorumApksG1: [
			operator1.blsKeyPair.pubG1.add(operator2.blsKeyPair.pubG1),
			operator1.blsKeyPair.pubG1.add(operator2.blsKeyPair.pubG1),
		],
		signersApkG2: operator1.blsKeyPair.pubG2.add(operator2.blsKeyPair.pubG2),
		signersAggSigG1: blsSign1.add(blsSign2),
		nonSignerQuorumBitmapIndices: [],
		quorumApkIndices: [],
		totalStakeIndices: [],
		nonSignerStakeIndices: [],
	} as BlsAggregationServiceResponse;

	const gotAggregatedResponse = await blsAggregationService.getAggregatedResponse(taskIndex)

	expect(stringifyAggResp(wantAggregatedResponse))
	.to.equal(stringifyAggResp(gotAggregatedResponse))
})

test("2 concurrent tasks 2 quorums 2 operators 2 correct signatures", async () => {
	const operator1:TestOperator = {
		operatorId: 1n,
		stakePerQuorum: {1: 100n, 2: 200n},
		blsKeyPair: KeyPair.fromString("01"),
	}
	const operator2:TestOperator = {
		operatorId: 2n,
		stakePerQuorum: {1: 100n, 2: 200n},
		blsKeyPair: KeyPair.fromString("02"),
	}

	const blockNumber = 1
	const quorumNumbers = [1, 2]
	const quorumThresholdPercentages = [100, 100]
	
	const fakeAvsRegistryService = new FakeAvsRegistryService(blockNumber, [operator1, operator2])
	const blsAggregationService = new BlsAggregationService(
		fakeAvsRegistryService,
		hashFunction,
	)

	const taskIndex1 = 1
	const taskResponse1 = "sample text response for tast case 4.1"
	const taskResponseDigest1 = hashFunction(taskResponse1)
	await blsAggregationService.initializeNewTask(taskIndex1, blockNumber, quorumNumbers, quorumThresholdPercentages, TIME_TO_EXPIRE_TASK)

	const taskIndex2 = 2
	const taskResponse2 = "sample text response for tast case 4.2"
	const taskResponseDigest2 = hashFunction(taskResponse2)
	await blsAggregationService.initializeNewTask(taskIndex2, blockNumber, quorumNumbers, quorumThresholdPercentages, TIME_TO_EXPIRE_TASK)

	const blsSign11 = operator1.blsKeyPair.signMessage(taskResponseDigest1)
	blsAggregationService.processNewSignature(taskIndex1, taskResponse1, blsSign11, operator1.operatorId)
		.catch(e => console.log(e));

	const blsSign12 = operator1.blsKeyPair.signMessage(taskResponseDigest2)
	blsAggregationService.processNewSignature(taskIndex2, taskResponse2, blsSign12, operator1.operatorId)
		.catch(e => console.log(e));

	const blsSign21 = operator2.blsKeyPair.signMessage(taskResponseDigest1)
	blsAggregationService.processNewSignature(taskIndex1, taskResponse1, blsSign21, operator2.operatorId)
		.catch(e => console.log(e));

	const blsSign22 = operator2.blsKeyPair.signMessage(taskResponseDigest2)
	blsAggregationService.processNewSignature(taskIndex2, taskResponse2, blsSign22, operator2.operatorId)
		.catch(e => console.log(e));

	const wantAggregatedResponse1 = {
		err: undefined,
		taskIndex: taskIndex1,
		taskResponse: taskResponse1,
		taskResponseDigest: taskResponseDigest1,
		nonSignersPubKeysG1: [],
		quorumApksG1: [
			operator1.blsKeyPair.pubG1.add(operator2.blsKeyPair.pubG1),
			operator1.blsKeyPair.pubG1.add(operator2.blsKeyPair.pubG1),
		],
		signersApkG2: operator1.blsKeyPair.pubG2.add(operator2.blsKeyPair.pubG2),
		signersAggSigG1: blsSign11.add(blsSign21),
		nonSignerQuorumBitmapIndices: [],
		quorumApkIndices: [],
		totalStakeIndices: [],
		nonSignerStakeIndices: [],
	} as BlsAggregationServiceResponse;

	const wantAggregatedResponse2 = {
		err: undefined,
		taskIndex: taskIndex2,
		taskResponse: taskResponse2,
		taskResponseDigest: taskResponseDigest2,
		nonSignersPubKeysG1: [],
		quorumApksG1: [
			operator1.blsKeyPair.pubG1.add(operator2.blsKeyPair.pubG1),
			operator1.blsKeyPair.pubG1.add(operator2.blsKeyPair.pubG1),
		],
		signersApkG2: operator1.blsKeyPair.pubG2.add(operator2.blsKeyPair.pubG2),
		signersAggSigG1: blsSign12.add(blsSign22),
		nonSignerQuorumBitmapIndices: [],
		quorumApkIndices: [],
		totalStakeIndices: [],
		nonSignerStakeIndices: [],
	} as BlsAggregationServiceResponse;

	const gotAggregatedResponse1 = await blsAggregationService.getAggregatedResponse(taskIndex1)
	const gotAggregatedResponse2 = await blsAggregationService.getAggregatedResponse(taskIndex2)

	expect(stringifyAggResp(wantAggregatedResponse1))
	.to.equal(stringifyAggResp(gotAggregatedResponse1))

	expect(stringifyAggResp(wantAggregatedResponse2))
	.to.equal(stringifyAggResp(gotAggregatedResponse2))
})

test("1 quorum 1 operator 0 signatures - task expired", async () => {
	const operator1:TestOperator = {
		operatorId: 1n,
		stakePerQuorum: {1: 100n, 2: 200n},
		blsKeyPair: KeyPair.fromString("01"),
	}

	const taskIndex = 1
	const blockNumber = 1

	const fakeAvsRegistryService = new FakeAvsRegistryService(blockNumber, [operator1])
	const blsAggregationService = new BlsAggregationService(
		fakeAvsRegistryService,
		hashFunction,
	)
	await blsAggregationService.initializeNewTask(taskIndex, blockNumber, [1], [100], TIME_TO_EXPIRE_TASK)	
	const wantAggregatedResponse = {
		err: {message: `Task ${taskIndex} expired`}
	};

	const gotAggregatedResponse = await blsAggregationService.getAggregatedResponse(taskIndex)
	
	// @ts-ignore
	expect(stringifyAggResp(wantAggregatedResponse))
	.to.equal(stringifyAggResp(gotAggregatedResponse))
})

test("1 quorum 2 operator 1 correct signature quorumThreshold 50% - verified", async () => {

	const operator1:TestOperator = {
		operatorId: 1n,
		stakePerQuorum: {1: 100n, 2: 200n},
		blsKeyPair: KeyPair.fromString("01"),
	}
	const operator2:TestOperator = {
		operatorId: 2n,
		stakePerQuorum: {1: 100n, 2: 200n},
		blsKeyPair: KeyPair.fromString("02"),
	}

	const blockNumber = 1
	const taskIndex = 1
	const quorumNumbers = [1]
	const quorumThresholdPercentages = [50]
	const taskResponse = "sample text response for tast case 6"
	const taskResponseDigest = hashFunction(taskResponse)
	
	const fakeAvsRegistryService = new FakeAvsRegistryService(blockNumber, [operator1, operator2])
	const blsAggregationService = new BlsAggregationService(
		fakeAvsRegistryService,
		hashFunction,
	)

	await blsAggregationService.initializeNewTask(taskIndex, blockNumber, quorumNumbers, quorumThresholdPercentages, TIME_TO_EXPIRE_TASK)

	const blsSign1 = operator1.blsKeyPair.signMessage(taskResponseDigest)
	blsAggregationService.processNewSignature(taskIndex, taskResponse, blsSign1, operator1.operatorId)
		.catch(e => console.log(e));

	const wantAggregatedResponse = {
		err: undefined,
		taskIndex,
		taskResponse,
		taskResponseDigest,
		nonSignersPubKeysG1: [operator2.blsKeyPair.pubG1],
		quorumApksG1: [operator1.blsKeyPair.pubG1.add(operator2.blsKeyPair.pubG1)],
		signersApkG2: operator1.blsKeyPair.pubG2,
		signersAggSigG1: blsSign1,
		nonSignerQuorumBitmapIndices: [],
		quorumApkIndices: [],
		totalStakeIndices: [],
		nonSignerStakeIndices: [],
	} as BlsAggregationServiceResponse;

	const gotAggregatedResponse = await blsAggregationService.getAggregatedResponse(taskIndex)
	
	expect(stringifyAggResp(wantAggregatedResponse))
	.to.equal(stringifyAggResp(gotAggregatedResponse))	
})

test("1 quorum 2 operator 1 correct signature quorumThreshold 60% - task expired", async () => {
	const operator1:TestOperator = {
		operatorId: 1n,
		stakePerQuorum: {1: 100n, 2: 200n},
		blsKeyPair: KeyPair.fromString("01"),
	}
	const operator2:TestOperator = {
		operatorId: 2n,
		stakePerQuorum: {1: 100n, 2: 200n},
		blsKeyPair: KeyPair.fromString("02"),
	}

	const blockNumber = 1
	const taskIndex = 1
	const quorumNumbers = [1]
	const quorumThresholdPercentages = [60]
	const taskResponse = "sample text response for tast case 7"
	const taskResponseDigest = hashFunction(taskResponse)
	
	const fakeAvsRegistryService = new FakeAvsRegistryService(blockNumber, [operator1, operator2])
	const blsAggregationService = new BlsAggregationService(
		fakeAvsRegistryService,
		hashFunction,
	)	

	await blsAggregationService.initializeNewTask(taskIndex, blockNumber, quorumNumbers, quorumThresholdPercentages, TIME_TO_EXPIRE_TASK)
	
	const blsSign1 = operator1.blsKeyPair.signMessage(taskResponseDigest)
	blsAggregationService.processNewSignature(taskIndex, taskResponse, blsSign1, operator1.operatorId)
		.catch(e => console.log(e));

	const wantAggregatedResponse = {
		err: {message: `Task ${taskIndex} expired`}
	};

	const gotAggregatedResponse = await blsAggregationService.getAggregatedResponse(taskIndex)
	
	// @ts-ignore
	expect(stringifyAggResp(wantAggregatedResponse))
	.to.equal(stringifyAggResp(gotAggregatedResponse))
})