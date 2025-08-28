import * as fs from 'fs';
import * as yaml from 'js-yaml';
import pino from 'pino';
import { G1Point, G2Point } from "eigensdk/crypto/bls/attestation"
import { Uint256 } from 'eigensdk/types/general';

const logger = pino({
    level: process.env.LOG_LEVEL || 'silent', // Set log level here
    transport: {
        target: 'pino-pretty',
        options: { 
            colorize: true,
            sync: true // Ensure pino-pretty is synchronous
        }
    },
});

export const timeout = (ms: number) => new Promise((resolve, reject) => setTimeout(resolve, ms))

export function g1ToTuple(g1: G1Point): [Uint256, Uint256] {
    return [BigInt(g1.getX().getStr()), BigInt(g1.getY().getStr())]
}

export function g2ToTuple(g2: G2Point, order:"ab"|"ba"="ab"): [[Uint256, Uint256],[Uint256, Uint256]] {
    if(order == "ab") {
        return [[
            BigInt(g2.getX().get_a().getStr()),
            BigInt(g2.getX().get_b().getStr()),
        ], [
            BigInt(g2.getY().get_a().getStr()),
            BigInt(g2.getY().get_b().getStr()),
        ]]
    }
    else if(order == "ba") {
        return [[
            BigInt(g2.getX().get_b().getStr()),
            BigInt(g2.getX().get_a().getStr()),
        ], [
            BigInt(g2.getY().get_b().getStr()),
            BigInt(g2.getY().get_a().getStr()),
        ]]
    }
    else
        throw `Unknown order ${order}`;
}

export function yamlLoad(path: string): any {
    if (!fs.existsSync(path)) {
        logger.error(`Config file not found at: ${path}`);
        throw new Error(`Config file not found at: ${path}`);
    }
    const content: string = fs.readFileSync(path, 'utf8');
    return yaml.load(content, { schema: yaml.JSON_SCHEMA }) as any;
}