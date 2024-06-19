import { ContractMethod, TransactionReceipt, Web3 } from 'web3';
import { LocalAccount } from '../types/general.js';

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

export async function sendTransaction(
    contractMethod: any,
    pkWallet: LocalAccount,
    ethHttpClient: Web3
): Promise<TransactionReceipt> {
	
	const web3 = ethHttpClient;

	const gasPrice = await web3.eth.getGasPrice();
	const gasLimit = await contractMethod.estimateGas({ from: pkWallet.address });

	const txObject = contractMethod.send({
		from: pkWallet.address,
		gasPrice: gasPrice,
		gas: gasLimit
	});

	const signedTx = await web3.eth.accounts.signTransaction(
		txObject,
		pkWallet.privateKey
	);

	const txReceipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

	return txReceipt;
}
