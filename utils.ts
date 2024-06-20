import { G1Point, G2Point } from "./eigensdk/crypto/bls/attestation"

export const timeout = (ms: number) => new Promise((resolve, reject) => setTimeout(resolve, ms))

export function g1ToTuple(g1: G1Point) {
    return [BigInt(g1.getX().getStr()), BigInt(g1.getY().getStr())]
}

export function g2ToTuple(g2: G2Point) {
    return [[
        BigInt(g2.getX().get_a().getStr()),
        BigInt(g2.getX().get_b().getStr()),
	], [
        BigInt(g2.getY().get_a().getStr()),
        BigInt(g2.getY().get_b().getStr()),
	]]
}