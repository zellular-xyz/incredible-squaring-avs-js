import {BuildAllConfig, buildAll} from '../chainio/clients/builder'
import pino from 'pino'

async function run() {
	const config = new BuildAllConfig(
		'https://ethereum-rpc.publicnode.com',
		'0x0BAAc79acD45A023E19345c352d8a7a83C4e5656',
		'0xD5D7fB4647cE79740E6e83819EFDf43fa74F8C31'
	)

	const logger = pino({ level: 'info' });

	const clients = await buildAll(config, "01".padStart(64, '0'), logger)

	const quorums = await clients.avsRegistryReader.getOperatorsStakeInQuorumsAtCurrentBlock([0, 1])

	console.log(quorums)
}

run()
	.catch(e => console.log(e))
	.finally(() => process.exit(0))