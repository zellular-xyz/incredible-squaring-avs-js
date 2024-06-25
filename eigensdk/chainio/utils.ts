import { TransactionReceipt, Web3 } from 'web3';
import { LocalAccount } from '../types/general.js';
import pino from 'pino';

const logger = pino({
    level: 'info', // Set log level here
    // prettyPrint: { colorize: true }
	transport: {
		target: 'pino-pretty'
	},
});	

export function numsToBytes(nums: number[]): Uint8Array {
	const chars: string[] = nums.map(num => String.fromCharCode(num));
	// const chars: string[] = nums.map(num => String.fromCodePoint(num));
	const joinedString: string = chars.join('');
	const bytes: Uint8Array = new TextEncoder().encode(joinedString);
	return bytes;
  }

export function bitmapToQuorumIds(bitmap: number): number[] {
  const quorumIds: number[] = [];
  for (let i = 0; i < 256; i++) {
    if (bitmap & (1 << i)) {
      quorumIds.push(i);
    }
  }
  return quorumIds;
}

export async function sendContractCall(
    contract: any,
	method: string,
	params: any[],
    pkWallet: LocalAccount,
    ethHttpClient: Web3
): Promise<TransactionReceipt> {
	const web3 = ethHttpClient;

	const contractMethod = contract.methods[method](...params)
	const gasPrice = await web3.eth.getGasPrice();

	const gasLimit = await contractMethod.estimateGas({from: pkWallet.address});

	const txParams = {
		data: contractMethod.encodeABI(),
		from: pkWallet.address,
		to: contract.options.address,
		gasPrice: gasPrice,
		gas: gasLimit
	};

	const signedTx = await web3.eth.accounts.signTransaction(
		txParams,
		pkWallet.privateKey
	);

	// logger.info({
	// 	contractAddress: contract.options.address,
	// 	method,
	// }, `Sending contract call transaction.`)
	
	return await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
}
