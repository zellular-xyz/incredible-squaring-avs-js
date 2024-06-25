import * as ethers from 'ethers'
import * as mcl from 'mcl-wasm'
import { newG1Point } from '../bls/attestation'

// modulus for the underlying field F_p of the elliptic curve
const FP_MODULUS: bigint =
    21888242871839275222246405745257275088696311157297823662689037894645226208583n;
// modulus for the underlying field F_r of the elliptic curve
const FR_MODULUS:bigint =
    21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const FIELD_ORDER = BigInt('0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47');

export async function init() {
  // await mcl.init(mcl.BN254);
  await mcl.init(mcl.BN_SNARK1);
  mcl.setETHserialization(true);
  mcl.setMapToMode(0);
}

const _G2_XA = BigInt("0x1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed")
const _G2_XB = BigInt("0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2")
const _G2_YA = BigInt("0x12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa")
const _G2_YB = BigInt("0x090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b")


export function verifySig(sig: mcl.G1, pubkey: mcl.G2, msg: string): boolean {
	const G2 = getG2Generator()
	const msgPoint = mapToCurve(msg);

	const gt1 = mcl.pairing(msgPoint, pubkey)
	const gt2 = mcl.pairing(sig, G2)

	return gt1.isEqual(gt2);
}

export function mapToCurve(_x: string): mcl.G1 {
	let beta = 0n;
	let y = 0n;
  
	let x:bigint = BigInt(_x) % FP_MODULUS;
  
	while (true) {
		const [beta, y] = findYFromX(x);
  
		// y^2 == beta
		if( beta == ((y * y) % FP_MODULUS) ) {
			return newG1Point(x, y);
		}
  
		x = (x + 1n) % FP_MODULUS;
	}
	return newG1Point(0n, 0n);
}

function addmod(a: bigint, b: bigint, m: bigint): bigint {
  return (a + b) % m
}

function mulmod(a: bigint, b: bigint, m: bigint): bigint {
  return (a * b) % m
}

function expmod(a: bigint, b: bigint, m: bigint): bigint {
  let result = 1n;
  let base = a;
  let _b = b;

  while (_b > 0n) {
    // Check the least significant bit (LSB) of b
    if (_b & 1n) {
      result = (result * base) % m;
    }
    // Right shift b by 1 (effectively dividing by 2, discarding the remainder)
    _b >>= 1n;
    // Square the base for the next iteration (efficient for repeated multiplication)
    base = (base * base) % m;
  }

  return result;
}

function findYFromX(x: bigint): bigint[] {
  // beta = (x^3 + b) % p
  let beta = addmod(mulmod(mulmod(x, x, FP_MODULUS), x, FP_MODULUS), 3n, FP_MODULUS);

  // y^2 = x^3 + b
  // this acts like: y = sqrt(beta) = beta^((p+1) / 4)
  let y = expmod(beta, BigInt("0xc19139cb84c680a6e14116da060561765e05aa45a1c72a34f082305b61f3f52"), FP_MODULUS);

  return [beta, y];
}

export function checkG1AndG2DiscreteLogEquality(pointG1: mcl.G1, pointG2: mcl.G2): boolean {
	const G1 = getG1Generator()
	const G2 = getG2Generator()
	
	const gt1 = mcl.pairing(pointG1, G2)
	const gt2 = mcl.pairing(G1, pointG2)

	return gt1.isEqual(gt2)
}

export function getG1Generator() {
	let G1 = new mcl.G1()
	G1.setStr(`1 1 2`);
	return G1
}

export function getG2Generator() {
	let G2 = new mcl.G2()
	G2.setStr(`1 ${_G2_XA} ${_G2_XB} ${_G2_YA} ${_G2_YB}`)
	return G2
}

export function mulByGeneratorG1(a: mcl.Fr): mcl.G1 {
	return mcl.mul(getG1Generator(), a)
}

export function mulByGeneratorG2(a: mcl.Fr): mcl.G2 {
	return mcl.mul(getG2Generator(), a)
}

export function random(): bigint {
	let hexVal = ethers.hexlify(ethers.randomBytes(32))
	return BigInt(hexVal) % FR_MODULUS;
}