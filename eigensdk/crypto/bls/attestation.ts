import { ethers } from "ethers";
import {eth as Web3Eth} from 'web3'
import * as mcl from 'mcl-wasm'
import * as bn254Utils from "../bn254/utils"
const fs = require('fs').promises;

export async function init() {
	await mcl.init(mcl.BN_SNARK1);
}

type encryptedBLSKeyJSONV3 = {
	publicKey: string,
	crypto: any
}

export function newFpElement(x: bigint): mcl.Fp {
	let p = new mcl.Fp()
	p.setStr(`${x}`, 10)
	return p;
}

export function newFp2Element(a: bigint, b: bigint): mcl.Fp2 {
	let p = new mcl.Fp2()
	p.set_a(newFpElement(a))
	p.set_b(newFpElement(b))
	return p;
}

export class G1Point extends mcl.G1{

	constructor(x: bigint, y: bigint) {
		super()
		if(x != undefined) {
			this.setX(newFpElement(x));
			this.setY(newFpElement(y));
			this.setZ(newFpElement(1n));
			if(x===0n && y===0n)
				this.clear()
		}
	}

	add(p: G1Point): G1Point {
		let res: mcl.G1 = mcl.add(this, p)
		return G1Point.fromStr(res.getStr());
	}

	sub(p: G1Point): G1Point {
		return G1Point.fromStr(mcl.sub(this, p).getStr());
	}

	verifyEquivalence(p: G2Point): boolean {
		return bn254Utils.checkG1AndG2DiscreteLogEquality(this, p);
	}

	static fromStr(val: string): G1Point {
		let res = new G1Point(0n, 0n)
		res.setStr(val)
		return res;
	}
}

export function newG1Point(x: bigint, y: bigint): G1Point {
	return new G1Point(x, y);
}

export function newZeroG1Point(): G1Point {
	return newG1Point(0n, 0n);
}

export class G2Point extends mcl.G2 {
	constructor(xa: bigint, xb: bigint, ya: bigint, yb: bigint) {
		super()
		if(xa != undefined) {
			this.setX(newFp2Element(xa, xb))
			this.setY(newFp2Element(ya, yb))
			this.setZ(newFp2Element(1n, 0n))
			if(xa===0n && xb===0n && ya===0n && yb===0n)
				this.clear()
		}
	}

	add(p: G2Point): G2Point {
		return G2Point.fromStr(mcl.add(this, p).getStr());
	}

	sub(p: G2Point): G2Point {
		return G2Point.fromStr(mcl.sub(this, p).getStr());
	}

	verifyEquivalence(p: G1Point): boolean {
		return bn254Utils.checkG1AndG2DiscreteLogEquality(p, this);
	}

	static fromStr(val: string): G2Point {
		let res = new G2Point(0n, 0n, 0n, 0n)
		res.setStr(val)
		return res;
	}
}

export function newG2Point(xa: bigint, xb:bigint, ya: bigint, yb:bigint): G2Point {
	return new G2Point(xa, xb, ya, yb);
}

export function newZeroG2Point(): G2Point {
	return newG2Point(0n, 0n, 0n, 0n);
}

export class Signature extends G1Point {

	static fromG1Point(p: G1Point): Signature {
		return new Signature(
			BigInt(p.getX().getStr()),
			BigInt(p.getY().getStr())
		)
	}

	toJson(): Object {
		return {
			x: this.getX().getStr(),
			y: this.getX().getStr()
		}
	}

	fromJson(s:{x: string, y: string}): Signature {
		return new Signature(
			BigInt(s.x),
			BigInt(s.y),
		)
	}

	add(s: Signature): Signature {
		return Signature.fromG1Point(mcl.add(this, s))
	}

	verify(publicKey: G2Point, msg: string): boolean {
		return bn254Utils.verifySig(this, publicKey, msg);
	}

	static fromStr(val: string): Signature {
		let res = new Signature(0n, 0n)
		res.setStr(val)
		return res;
	}
}

export function newZereSignature() {
	return new Signature(0n, 0n);
}

export class PrivateKey extends mcl.Fr {
	constructor(secret?: string, base:number=16) {
		super()
		if(secret)
			this.setStr(secret, base)
		else
			this.setStr(`${bn254Utils.random()}`, 10)
	}

	getStr(): string {
		return super.getStr(16).padStart(64, '0')
	}
}

export function newPrivateKey(sk: string, base:number=16): PrivateKey {
	return new PrivateKey(sk, base)
}

export class KeyPair {
	privKey:PrivateKey;
	pubG1: G1Point;
	pubG2: G2Point;

	constructor(privKey?: PrivateKey) {
		this.privKey = privKey ? privKey : new PrivateKey()

		this.pubG1 = G1Point.fromStr(bn254Utils.mulByGeneratorG1(this.privKey).getStr())
		this.pubG2 = G2Point.fromStr(bn254Utils.mulByGeneratorG2(this.privKey).getStr())
	}

	static fromString(secret:string, base:number=16):KeyPair {
		const pk = new PrivateKey(secret, base)
		return new KeyPair(pk);
	}

	async saveToFile(path: string, password: string) {
		// @ts-ignore
		const privateKey = "0x" + this.privKey.getStr(16).padStart(64, "0")
		let wallet = new ethers.Wallet(privateKey)
		let keystoreJson = {
			pubKey: this.pubG1.getStr(),
			crypto: await ethers.encryptKeystoreJson({address: wallet.address, privateKey}, password)
		}
		await fs.writeFile(path, JSON.stringify(keystoreJson), "utf-8")
	}

	static async readFromFile(path: string, password: string): Promise<KeyPair> {
		const data = await fs.readFile(path, 'utf-8');
		const keystoreJson = JSON.parse(data);

		if (!keystoreJson.address)
			keystoreJson.id = "00000000-0000-0000-0000-000000000000"

		if (!keystoreJson.address) 
			keystoreJson.address = "0x0000000000000000000000000000000000000000"

		let keystoreAccount = await Web3Eth.accounts.decrypt(keystoreJson, password)
		return KeyPair.fromString(keystoreAccount.privateKey, 16)
	}

	signMessage(msg: string): Signature {
		let h = bn254Utils.mapToCurve(msg) as G1Point
		return this.signHashedToCurveMessage(h);
	}

	signHashedToCurveMessage(msg: G1Point): Signature {
		const sig = mcl.mul(msg, this.privKey)
		sig.normalize()
		return Signature.fromG1Point(sig as G1Point)
	}

	getPubKeyG1(): G1Point {
		return this.pubG1
	}

	getPubKeyG2(): G2Point {
		return this.pubG2
	}
}

export function newKeyPair(privKey: PrivateKey): KeyPair {
	return new KeyPair(privKey)
}

export function newKeyPairFromString(secret: string, base:number=16): KeyPair {
	return KeyPair.fromString(secret, base);
}

export function getRandomBlsKeyPair(): KeyPair {
	return new KeyPair()
}