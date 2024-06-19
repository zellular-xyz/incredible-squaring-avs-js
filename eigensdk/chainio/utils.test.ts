import { expect, test, beforeAll } from 'vitest';
import { Web3 } from 'web3';

const providerUrl = 'https://data-seed-prebsc-1-s1.binance.org:8545/';

async function createAccount() {
  try {
    const web3 = new Web3(new Web3.providers.HttpProvider(providerUrl));

    // Generate a random private key (not recommended for production)
    const privateKey = await web3.eth.accounts.create();
	console.log(privateKey)
    const address = web3.eth.accounts.privateKeyToAccount(privateKey).address;

    console.log('Private Key:', privateKey);
    console.log('Address:', address);
  } catch (error) {
    console.error('Error creating account:', error);
  }
}

test("========== sample ==========", async () => {
	await createAccount();
})