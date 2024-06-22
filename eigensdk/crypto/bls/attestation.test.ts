// my-function.ts (your function to be tested)
import { expect, test, beforeAll } from 'vitest';
import { init, G1Point, KeyPair, G2Point, Signature, newZereSignature } from './attestation';
import * as bn254Utils from "../bn254/utils.js"
import * as ethers from 'ethers';
// import 

function hashFunction(input: string): string {
	return ethers.keccak256(Buffer.from(input));
}

beforeAll(async () => {
	await bn254Utils.init();
})

test('PrivateKey.from_string should work', async () => {
	const privKeyStr = "0000000000000000000000000000000000000000000000000000000012345678"
	const keyPair = KeyPair.fromString(privKeyStr)
	expect(privKeyStr).to.equal(keyPair.privKey.getStr());
});

test('Save and load of keystore should work', async () => {
	const privKeyStr = "0000000000000000000000000000000000000000000000000000000012345678"
	const keyPair = KeyPair.fromString(privKeyStr)

	const password = "123"
	const pathToSave = "./test-keystore-save.json"
	await keyPair.saveToFile(pathToSave, password)
	const keyPair2 = await KeyPair.readFromFile(pathToSave, password)

	expect(privKeyStr).to.equal(keyPair2.privKey.getStr());
});

test('Signature aggregation should work.', async () => {
	const textMessage = "sample text to sign"
	const msgHash = hashFunction(textMessage)

	const keyPair1 = new KeyPair()
	const keyPair2 = KeyPair.fromString("04")

	const sign1:Signature = keyPair1.signMessage(msgHash)
	const sign2:Signature = keyPair2.signMessage(msgHash)

	const aggregatedSignature:Signature = sign1.add(sign2);
	const aggregatedPubG2:G2Point = keyPair1.pubG2.add(keyPair2.pubG2)

	const verified = aggregatedSignature.verify(aggregatedPubG2, msgHash)

	expect(verified).to.equal(true);
})