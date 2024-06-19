// import { ethers } from "ethers";
import { Logger } from "pino";
// import { ELReader, G1Point, KeyPair, TxReceipt, utils, sendTransaction } from "./utils";
import {ELReader} from '../elcontracts/reader'
import { Web3, Contract, Address, TransactionReceipt } from "web3";
import { G1Point, KeyPair, Signature } from "../../../crypto/bls/attestation";
import * as chainIoUtils from '../../utils'
import * as ABIs from '../../../contracts/ABIs'
import { LocalAccount } from "../../../types/general";

const DEFAULT_QUERY_BLOCK_RANGE = 10_000;

export class AvsRegistryWriter {
    serviceManagerAddr: Address;
    registryCoordinator: Contract<typeof ABIs.REGISTRY_COORDINATOR>;
    operatorStateRetriever: Contract<typeof ABIs.OPERATOR_STATE_RETRIEVER>;
    stakeRegistry: Contract<typeof ABIs.STAKE_REGISTRY>;
    blsApkRegistry: Contract<typeof ABIs.BLS_APK_REGISTRY>;
    elReader: ELReader;
    logger: Logger;
    ethHttpClient: Web3;
    pkWallet: LocalAccount;

    constructor(
        serviceManagerAddr: Address,
        registryCoordinator: Contract<typeof ABIs.REGISTRY_COORDINATOR>,
        operatorStateRetriever: Contract<typeof ABIs.OPERATOR_STATE_RETRIEVER>,
        stakeRegistry: Contract<typeof ABIs.STAKE_REGISTRY>,
        blsApkRegistry: Contract<typeof ABIs.BLS_APK_REGISTRY>,
        elReader: ELReader,
        logger: Logger,
        ethHttpClient: Web3,
        pkWallet: LocalAccount,
    ) {
        this.serviceManagerAddr = serviceManagerAddr;
        this.registryCoordinator = registryCoordinator;
        this.operatorStateRetriever = operatorStateRetriever;
        this.stakeRegistry = stakeRegistry;
        this.blsApkRegistry = blsApkRegistry;
        this.elReader = elReader;
        this.logger = logger;
        this.ethHttpClient = ethHttpClient;
        this.pkWallet = pkWallet;
    }

    async registerOperatorInQuorumWithAvsRegistryCoordinator(
        operatorEcdsaPrivateKey: string,
        operatorToAvsRegistrationSigSalt: Uint8Array,
        operatorToAvsRegistrationSigExpiry: number,
        blsKeyPair: KeyPair,
        quorumNumbers: number[],
        socket: string,
    ): Promise<TransactionReceipt | null> {
        const account = this.ethHttpClient.eth.accounts.privateKeyToAccount(operatorEcdsaPrivateKey);
        const operatorAddr = account.address;
        this.logger.info("Registering operator with the AVS's registry coordinator", {
            "avs-service-manager": this.serviceManagerAddr,
            "operator": operatorAddr,
            "quorumNumbers": quorumNumbers,
            "socket": socket,
        });

        const g1HashedMsgToSign = await this.registryCoordinator.methods.pubkeyRegistrationMessageHash(operatorAddr).call();
		if(!g1HashedMsgToSign)
			throw `Unable to get pubkeyRegistrationMessageHash`
        const signedMsg: Signature = blsKeyPair.signHashedToCurveMessage(new G1Point(
			BigInt(g1HashedMsgToSign[0]),
			BigInt(g1HashedMsgToSign[1]),
		));

        const pubkeyRegParams = [
            [signedMsg.getX().getStr(), signedMsg.getY().getStr()],
            [blsKeyPair.pubG1.getX().getStr(), blsKeyPair.pubG1.getY().getStr()],
            [
                [blsKeyPair.pubG2.getX().get_a().getStr(), blsKeyPair.pubG2.getX().get_b().getStr()],
                [blsKeyPair.pubG2.getY().get_a().getStr(), blsKeyPair.pubG2.getY().get_b().getStr()],
            ],
        ];

        const msgToSign:string = await this.elReader.calculateOperatorAvsRegistrationDigestHash(
            operatorAddr,
            this.serviceManagerAddr,
            operatorToAvsRegistrationSigSalt,
            operatorToAvsRegistrationSigExpiry,
        );
        const operatorSignature = this.ethHttpClient.eth.accounts.sign(msgToSign, operatorEcdsaPrivateKey);
        const operatorSignatureWithSaltAndExpiry = [
            operatorSignature,
            operatorToAvsRegistrationSigSalt,
            operatorToAvsRegistrationSigExpiry,
        ];

        const func = await this.registryCoordinator.methods.registerOperator(
            chainIoUtils.numsToBytes(quorumNumbers),
            socket,
            pubkeyRegParams,
            operatorSignatureWithSaltAndExpiry,
        );
        try {
            const receipt = await chainIoUtils.sendTransaction(func, this.pkWallet, this.ethHttpClient);
            this.logger.info("Successfully registered operator with AVS registry coordinator", {
                "txHash": receipt.transactionHash,
                "avs-service-manager": this.serviceManagerAddr,
                "operator": operatorAddr,
                "quorumNumbers": quorumNumbers,
            });
            return receipt;
        } catch (e) {
            this.logger.error(e);
            return null;
        }
    }

    async updateStakesOfEntireOperatorSetForQuorums(
        operatorsPerQuorum: Address[][],
        quorumNumbers: number[],
    ): Promise<TransactionReceipt | null> {
        this.logger.info("Updating stakes for entire operator set", {
            "quorumNumbers": quorumNumbers,
        });

        const func = await this.registryCoordinator.methods.updateOperatorsForQuorum(
            operatorsPerQuorum, chainIoUtils.numsToBytes(quorumNumbers)
        );
        try {
            const receipt = await chainIoUtils.sendTransaction(func, this.pkWallet, this.ethHttpClient);
            this.logger.info("Successfully updated stakes for entire operator set", {
                "txHash": receipt.transactionHash,
                "quorumNumbers": quorumNumbers,
            });
            return receipt;
        } catch (e) {
            this.logger.error(e);
            return null;
        }
    }

    async updateStakesOfOperatorSubsetForAllQuorums(operators: Address[]): Promise<TransactionReceipt | null> {
        this.logger.info("Updating stakes of operator subset for all quorums", {
            "operators": operators,
        });

        const func = await this.registryCoordinator.methods.updateOperators(operators);
        try {
            const receipt = await chainIoUtils.sendTransaction(func, this.pkWallet, this.ethHttpClient);
            this.logger.info("Successfully updated stakes of operator subset for all quorums", {
                "txHash": receipt.transactionHash,
                "operators": operators,
            });
            return receipt;
        } catch (e) {
            this.logger.error(e);
            return null;
        }
    }

    async deregisterOperator(quorumNumbers: number[]): Promise<TransactionReceipt | null> {
        this.logger.info("Deregistering operator with the AVS's registry coordinator");

        const func = await this.registryCoordinator.methods.deregisterOperator(
            chainIoUtils.numsToBytes(quorumNumbers)
        );
        try {
            const receipt = await chainIoUtils.sendTransaction(func, this.pkWallet, this.ethHttpClient);
            this.logger.info("Successfully deregistered operator with the AVS's registry coordinator", {
                "txHash": receipt.transactionHash,
            });
            return receipt;
        } catch (e) {
            this.logger.error(e);
            return null;
        }
    }

    async updateSocket(socket: string): Promise<TransactionReceipt | null> {
        this.logger.info("Updating socket", {
            "socket": socket,
        });

        const func = this.registryCoordinator.methods.updateSocket(socket);
        try {
            const receipt = await chainIoUtils.sendTransaction(func, this.pkWallet, this.ethHttpClient);
            this.logger.info("Successfully updated socket", {
                "txHash": receipt.transactionHash,
            });
            return receipt;
        } catch (e) {
            this.logger.error(e);
            return null;
        }
    }
}