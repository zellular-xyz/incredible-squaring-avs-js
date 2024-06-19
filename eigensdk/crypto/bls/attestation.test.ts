// my-function.ts (your function to be tested)
import { expect, test, beforeAll } from 'vitest';
import { init, G1Point, KeyPair } from './attestation';
import * as bn254Utils from "../bn254/utils.js"
import { Signature } from 'ethers';
// import 

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