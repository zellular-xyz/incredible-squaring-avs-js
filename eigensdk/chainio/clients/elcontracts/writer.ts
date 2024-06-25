import {Logger} from 'pino'
import { Operator } from '../../../services/avsregistry/avsregistry';
import { 
	Contract, 
	Web3, 
	Address, 
	TransactionReceipt
} from "web3";
// import {TxReceipt, LocalAccount } from "web3";
import * as ABIs from '../../../contracts/ABIs'
import {sendContractCall} from "../../utils";
import { ELReader } from './reader';
import { LocalAccount } from '../../../types/general';


export class ELWriter {
	constructor(
		private readonly slasher: Contract<typeof ABIs.SLASHER>,
		private readonly delegationManager: Contract<typeof ABIs.DELEGATION_MANAGER>,
		private readonly strategyManager: Contract<typeof ABIs.STRATEGY_MANAGER>,
		private readonly strategyManagerAddr: Address,
		private readonly avsDirectory: Contract<typeof ABIs.AVS_DIRECTORY>,
		private readonly elReader: ELReader,
		private readonly logger: Logger,
		private readonly ethHttpClient: Web3,
		private readonly pkWallet: LocalAccount,
	) {}

	async registerAsOperator(operator: Operator): Promise<TransactionReceipt | null> {
		this.logger.info(`Registering operator ${operator.address} to EigenLayer`);

		const opDetails: {
			earningsReceiver: string;
			stakerOptOutWindowBlocks?: number;
			delegationApprover: string;
		} = {
			earningsReceiver: Web3.utils.toChecksumAddress(operator.earningsReceiverAddress),
			stakerOptOutWindowBlocks: operator.stakerOptOutWindowBlocks,
			delegationApprover: Web3.utils.toChecksumAddress(operator.delegationApproverAddress),
		};

		// const func = this.delegationManager.methods.registerAsOperator();

		try {
			const receipt = sendContractCall(
				this.delegationManager,
				"registerAsOperator",
				[opDetails, operator.metadataUrl], 
				this.pkWallet, 
				this.ethHttpClient
			);
			return receipt;
		} catch (e) {
			this.logger.error("An error occurred when registering operator", e);
			return null;
		}
	}

	async updateOperatorDetails(operator: Operator): Promise<TransactionReceipt | null> {
		this.logger.info(`Updating operator details of operator ${operator.address} to EigenLayer`);

		const opDetails: {
			earningsReceiver: string;
			delegationApprover: string;
			stakerOptOutWindowBlocks?: number;
		} = {
			earningsReceiver: Web3.utils.toChecksumAddress(operator.earningsReceiverAddress),
			delegationApprover: Web3.utils.toChecksumAddress(operator.delegationApproverAddress),
			stakerOptOutWindowBlocks: operator.stakerOptOutWindowBlocks,
		};

		let receipt: TransactionReceipt | null = null;

		try {
			// Update operator details
			receipt = await sendContractCall(
				this.delegationManager,
				'modifyOperatorDetails',
				[opDetails], 
				this.pkWallet, 
				this.ethHttpClient
			);
		} catch (e) {
			this.logger.error(e);
			return null;
		}

		if (receipt) {
			this.logger.info("Successfully updated operator details", {
				txHash: receipt.transactionHash,
				operator: operator.address,
			});
		}

		try {
			// Update operator metadata URI (if successful)
			receipt = await sendContractCall(
				this.delegationManager,
				'updateOperatorMetadataURI',
				[operator.metadataUrl],
				this.pkWallet, 
				this.ethHttpClient
			);
		} catch (e) {
			this.logger.error(e);
			return null;
		}

		if (receipt) {
			this.logger.info("Successfully updated operator metadata URI", {
				txHash: receipt.transactionHash,
				operator: operator.address,
			});
		}

		return receipt;
	}

	async depositErc20IntoStrategy(strategyAddr: Address, amount: number): Promise<TransactionReceipt | null> {
		this.logger.info(`Depositing ${amount} tokens into strategy ${strategyAddr}`);

		let underlyingTokenContract: Contract<typeof ABIs.ERC20> | undefined;
		let underlyingTokenAddr: Address | undefined;

		try {
			const [strategy, token] = await this.elReader.getStrategyAndUnderlyingErc20Token(strategyAddr);
			underlyingTokenContract = token;
			// @ts-ignore
			underlyingTokenAddr = token.address;
		} catch (e) {
			this.logger.error(e);
			return null;
		}

		if (!underlyingTokenContract || !underlyingTokenAddr) {
			this.logger.error('Failed to retrieve underlying token information');
			return null;
		}

		try {
			await sendContractCall(
				underlyingTokenContract,
				"approve",
				[this.strategyManagerAddr, amount], 
				this.pkWallet, 
				this.ethHttpClient
			);
		} catch (error) {
			this.logger.error(error);
			return null;
		}

		try {
			const receipt = await sendContractCall(
				this.strategyManager, 
				"depositIntoStrategy", 
				[strategyAddr, underlyingTokenAddr, amount], 
				this.pkWallet, 
				this.ethHttpClient
			);
			this.logger.info('Successfully deposited the token into the strategy', {
				txHash: receipt.transactionHash,
				strategy: strategyAddr,
				token: underlyingTokenAddr,
				amount,
			});
			return receipt;
		} catch (error) {
			this.logger.error(error);
			return null;
		}
	}
}
