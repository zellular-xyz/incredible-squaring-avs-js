// import { ethers } from "ethers";
import { Logger } from "pino";
// import { ELReader, G1Point, KeyPair, TxReceipt, utils, sendTransaction } from "./utils";
import {ELReader} from '../elcontracts/reader'
import { Web3, Contract, Address, TransactionReceipt } from "web3";
import { G1Point, KeyPair, Signature } from "../../../crypto/bls/attestation";
import * as chainIoUtils from '../../utils'
import * as ABIs from '../../../contracts/ABIs'
import { LocalAccount } from "../../../types/general";
import { signRawData } from "../../../utils/helpers";

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
        operatorToAvsRegistrationSigSalt: string,
        operatorToAvsRegistrationSigExpiry: number,
        blsKeyPair: KeyPair,
        quorumNumbers: number[],
        socket: string,
    ): Promise<TransactionReceipt | null> {
        const account = this.ethHttpClient.eth.accounts.privateKeyToAccount(operatorEcdsaPrivateKey);
        const operatorAddr = account.address;
        this.logger.info({
            "avs-service-manager": this.serviceManagerAddr,
            "operator": operatorAddr,
            "quorumNumbers": quorumNumbers,
            "socket": socket,
        }, "Registering operator with the AVS's registry coordinator");

        const g1HashedMsgToSign = await this.registryCoordinator.methods.pubkeyRegistrationMessageHash(operatorAddr).call();
		if(!g1HashedMsgToSign)
			throw `Unable to get pubkeyRegistrationMessageHash`
        const signedMsg: Signature = blsKeyPair.signHashedToCurveMessage(new G1Point(
			g1HashedMsgToSign[0],
			g1HashedMsgToSign[1],
		));
        const pubkeyRegParams = [
            {X: signedMsg.getX().getStr(), Y: signedMsg.getY().getStr()},
            {X: blsKeyPair.pubG1.getX().getStr(), Y: blsKeyPair.pubG1.getY().getStr()},
            {
                X: [blsKeyPair.pubG2.getX().get_b().getStr(), blsKeyPair.pubG2.getX().get_a().getStr()],
                Y: [blsKeyPair.pubG2.getY().get_b().getStr(), blsKeyPair.pubG2.getY().get_a().getStr()],
			},
        ];
        const msgToSign:string = await this.elReader.calculateOperatorAvsRegistrationDigestHash(
            operatorAddr,
            this.serviceManagerAddr,
            operatorToAvsRegistrationSigSalt,
            operatorToAvsRegistrationSigExpiry,
        );
        const operatorSignature = signRawData(msgToSign, operatorEcdsaPrivateKey)

        const operatorSignatureWithSaltAndExpiry = [
			// @ts-ignore
            operatorSignature,
            operatorToAvsRegistrationSigSalt,
            operatorToAvsRegistrationSigExpiry,
        ];
        try {
            const receipt = await chainIoUtils.sendContractCall(
				this.registryCoordinator, 
				"registerOperator",
				[
					chainIoUtils.numsToBytes(quorumNumbers),
					socket,
					pubkeyRegParams,
					operatorSignatureWithSaltAndExpiry,
				],
				this.pkWallet, 
				this.ethHttpClient
			);
            this.logger.info({
                "txHash": receipt.transactionHash,
                "avs-service-manager": this.serviceManagerAddr,
                "operator": operatorAddr,
                "quorumNumbers": quorumNumbers,
            }, "Successfully registered operator with AVS registry coordinator");
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

        try {
            const receipt = await chainIoUtils.sendContractCall(
				this.registryCoordinator,
				"updateOperatorsForQuorum",
				[operatorsPerQuorum, chainIoUtils.numsToBytes(quorumNumbers)], 
				this.pkWallet, 
				this.ethHttpClient
			);
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

        try {
            const receipt = await chainIoUtils.sendContractCall(
				this.registryCoordinator,
				"updateOperators",
				[operators], 
				this.pkWallet, 
				this.ethHttpClient
			);
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

        try {
            const receipt = await chainIoUtils.sendContractCall(
				this.registryCoordinator, 
				"deregisterOperator",
				[chainIoUtils.numsToBytes(quorumNumbers)],
				this.pkWallet, 
				this.ethHttpClient
			);
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

        try {
            const receipt = await chainIoUtils.sendContractCall(
				this.registryCoordinator,
				"updateSocket",
				[socket], 
				this.pkWallet,
				this.ethHttpClient
			);
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