import {Logger} from 'pino'
import { Contract, Web3, Address } from "web3";
import * as ABIs from '../../../contracts/ABIs'
import { Operator } from '../../../services/avsregistry/avsregistry';

export class ELReader {
  constructor(
    private readonly slasher: Contract<typeof ABIs.SLASHER>,
    private readonly delegationManager: Contract<typeof ABIs.DELEGATION_MANAGER>,
    private readonly strategyManager: Contract<typeof ABIs.STRATEGY_MANAGER>,
    private readonly avsDirectory: Contract<typeof ABIs.AVS_DIRECTORY>,
    private readonly logger: Logger,
    private readonly ethHttpClient: Web3,
  ) {}

  async isOperatorRegistered(operatorAddr: Address): Promise<boolean> {
	const isOperator:boolean = await this.delegationManager.methods.isOperator(operatorAddr).call()
    return isOperator;
  }

  async getOperatorDetails(operatorAddr: Address): Promise<Operator> {
    const operatorDetails = await this.delegationManager.methods.operatorDetails(operatorAddr).call() as any[];

    return {
      address: operatorAddr,
      earningsReceiverAddress: this.ethHttpClient.utils.toChecksumAddress(operatorDetails[0]),
      stakerOptOutWindowBlocks: operatorDetails[2],
      delegationApproverAddress: this.ethHttpClient.utils.toChecksumAddress(operatorDetails[1]),
    } as Operator
  }

  async getStrategyAndUnderlyingToken(strategyAddr: Address): Promise<[Contract<typeof ABIs.STRATEGY>, string]> {
    const strategy: Contract<typeof ABIs.STRATEGY> = new this.ethHttpClient.eth.Contract(
      ABIs.STRATEGY,
      strategyAddr,
    );
    const underlyingTokenAddr = await strategy.methods.underlyingToken().call() as string;
    return [strategy, underlyingTokenAddr];
  }

  async getStrategyAndUnderlyingErc20Token(strategyAddr: Address): Promise<[Contract<typeof ABIs.STRATEGY>, Contract<typeof ABIs.ERC20>, Address]> {
    const strategy: Contract<typeof ABIs.STRATEGY> = new this.ethHttpClient.eth.Contract(
      ABIs.STRATEGY,
      strategyAddr,
    );
    const underlyingTokenAddr = await strategy.methods.underlyingToken().call() as string;
    const underlyingToken: Contract<typeof ABIs.ERC20> = new this.ethHttpClient.eth.Contract(
      ABIs.ERC20,
      underlyingTokenAddr,
    );
    return [strategy, underlyingToken, underlyingTokenAddr];
  }

  async serviceManagerCanSlashOperatorUntilBlock(operatorAddr: Address, serviceManagerAddr: Address): Promise<number> {
    return await this.slasher.methods.contractCanSlashOperatorUntilBlock(operatorAddr, serviceManagerAddr).call() as number;
  }

  async operatorIsFrozen(operatorAddr: Address): Promise<boolean> {
    return await this.slasher.methods.isFrozen(operatorAddr).call() as boolean;
  }

  async getOperatorSharesInStrategy(operatorAddr: Address, strategyAddr: Address): Promise<number> {
    return await this.delegationManager.methods.operatorShares(operatorAddr, strategyAddr).call() as number;
  }

  async calculateDelegationApprovalDigestHash(
    staker: Address,
    operatorAddr: Address,
    delegationApprover: Address,
    approverSalt: Uint8Array, // Assuming bytes are converted to Uint8Array
    expiry: number,
  ): Promise<string> {
    return await this.delegationManager.methods.calculateDelegationApprovalDigestHash(
      staker,
      operatorAddr,
      delegationApprover,
      approverSalt,
      expiry,
    ).call() as string;
  }

  async calculateOperatorAvsRegistrationDigestHash(
    operatorAddr: Address,
    avs: Address,
    salt: Uint8Array, // Assuming bytes are converted to Uint8Array
    expiry: number,
  ): Promise<string> {
    return await this.avsDirectory.methods.calculateOperatorAvsRegistrationDigestHash(
      operatorAddr,
      avs,
      salt,
      expiry,
    ).call() as string;
  }
}
