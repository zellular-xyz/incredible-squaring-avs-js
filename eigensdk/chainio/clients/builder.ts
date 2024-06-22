import { ethers } from 'ethers';
import { Web3 } from 'web3';
import { AbiItem } from 'web3-utils';
import pino, { Logger } from 'pino';
import * as ABIs from '../../contracts/ABIs';

import {AvsRegistryReader} from './avsregistry/reader';
import {AvsRegistryWriter} from './avsregistry/writer';
import {ELReader} from './elcontracts/reader';
import {ELWriter} from './elcontracts/writer';
import { LocalAccount } from '../../types/general';

const logger = pino({ level: 'info' });

export class BuildAllConfig {
    ethHttpUrl: string;
    registryCoordinatorAddr: string;
    operatorStateRetrieverAddr: string;
    avsName?: string;
    promMetricsIpPortAddress?: string;

    constructor(
        ethHttpUrl: string,
        registryCoordinatorAddr: string,
        operatorStateRetrieverAddr: string,
        avsName?: string,
        promMetricsIpPortAddress?: string
    ) {
        this.ethHttpUrl = ethHttpUrl;
        this.registryCoordinatorAddr = registryCoordinatorAddr;
        this.operatorStateRetrieverAddr = operatorStateRetrieverAddr;
        this.avsName = avsName;
        this.promMetricsIpPortAddress = promMetricsIpPortAddress;
    }

    async buildElClients(pkWallet: LocalAccount): Promise<[ELReader, ELWriter]> {
        const ethHttpClient = new Web3(new Web3.providers.HttpProvider(this.ethHttpUrl));
        const registryCoordinator = new ethHttpClient.eth.Contract(
			ABIs.REGISTRY_COORDINATOR as AbiItem[], 
			this.registryCoordinatorAddr
		);

        const stakeRegistryAddr:string = await registryCoordinator.methods.stakeRegistry().call();
        const stakeRegistry = new ethHttpClient.eth.Contract(
			ABIs.STAKE_REGISTRY as AbiItem[], 
			stakeRegistryAddr
		);

        const delegationManagerAddr:string = await stakeRegistry.methods.delegation().call();
        const delegationManager = new ethHttpClient.eth.Contract(
			ABIs.DELEGATION_MANAGER as AbiItem[], 
			delegationManagerAddr
		);

        const slasherAddr:string = await delegationManager.methods.slasher().call();
        const slasher = new ethHttpClient.eth.Contract(ABIs.SLASHER as AbiItem[], slasherAddr);

        const strategyManagerAddr:string = await delegationManager.methods.strategyManager().call();
        const strategyManager = new ethHttpClient.eth.Contract(ABIs.STRATEGY_MANAGER as AbiItem[], strategyManagerAddr);

        const serviceManagerAddr:string = await registryCoordinator.methods.serviceManager().call();
        const serviceManager = new ethHttpClient.eth.Contract(ABIs.SERVICE_MANAGER as AbiItem[], serviceManagerAddr);

        const avsDirectoryAddr:string  = await serviceManager.methods.avsDirectory().call();
        const avsDirectory = new ethHttpClient.eth.Contract(ABIs.AVS_DIRECTORY as AbiItem[], avsDirectoryAddr);

        const elReaderInstance = new ELReader(
            slasher,
            delegationManager,
            strategyManager,
            avsDirectory,
            logger,
            ethHttpClient
        );

        const elWriterInstance = new ELWriter(
            slasher,
            delegationManager,
            strategyManager,
            strategyManagerAddr,
            avsDirectory,
            elReaderInstance,
            logger,
            ethHttpClient,
            pkWallet
        );

        return [elReaderInstance, elWriterInstance];
    }

    async buildAvsRegistryClients(
        elReader: ELReader,
    	pkWallet: LocalAccount
    ): Promise<[AvsRegistryReader, AvsRegistryWriter]> {
        const ethHttpClient = new Web3(new Web3.providers.HttpProvider(this.ethHttpUrl));
        const registryCoordinator = new ethHttpClient.eth.Contract(
			ABIs.REGISTRY_COORDINATOR as AbiItem[], 
			this.registryCoordinatorAddr
		);
        const serviceManagerAddr:string = await registryCoordinator.methods.serviceManager().call();

        const blsApkRegistryAddr:string  = await registryCoordinator.methods.blsApkRegistry().call();
        const blsApkRegistry = new ethHttpClient.eth.Contract(
			ABIs.BLS_APK_REGISTRY as AbiItem[], 
			blsApkRegistryAddr
		);

        const operatorStateRetriever = new ethHttpClient.eth.Contract(
			ABIs.OPERATOR_STATE_RETRIEVER as AbiItem[], 
			this.operatorStateRetrieverAddr
		);

        const stakeRegistryAddr:string = await registryCoordinator.methods.stakeRegistry().call();
        const stakeRegistry = new ethHttpClient.eth.Contract(
			ABIs.STAKE_REGISTRY as AbiItem[], 
			stakeRegistryAddr
		);

        const avsRegistryReader = new AvsRegistryReader(
            this.registryCoordinatorAddr,
            registryCoordinator,
            blsApkRegistryAddr,
            blsApkRegistry,
            operatorStateRetriever,
            stakeRegistry,
            logger,
            ethHttpClient
        );

        const avsRegistryWriter = new AvsRegistryWriter(
            serviceManagerAddr,
            registryCoordinator,
            operatorStateRetriever,
            stakeRegistry,
            blsApkRegistry,
            elReader,
            logger,
            ethHttpClient,
            pkWallet
        );

        return [avsRegistryReader, avsRegistryWriter];
    }
}

export class Clients {
    avsRegistryReader: AvsRegistryReader;
    avsRegistryWriter: AvsRegistryWriter;
    elReader: ELReader;
    elWriter: ELWriter;
    ethHttpClient: Web3;
    wallet: LocalAccount;
    metrics: any;

    constructor(
        avsRegistryReader: AvsRegistryReader,
        avsRegistryWriter: AvsRegistryWriter,
        elReader: ELReader,
        elWriter: ELWriter,
        ethHttpClient: Web3,
        wallet: LocalAccount,
        metrics: any
    ) {
        this.avsRegistryReader = avsRegistryReader;
        this.avsRegistryWriter = avsRegistryWriter;
        this.elReader = elReader;
        this.elWriter = elWriter;
        this.ethHttpClient = ethHttpClient;
        this.wallet = wallet;
        this.metrics = metrics;
    }
}

export async function buildAll(config: BuildAllConfig, ecdsaPrivateKey: string, logger: Logger): Promise<Clients> {
    const ethHttpClient = new Web3(new Web3.providers.HttpProvider(config.ethHttpUrl));
    const pkWallet = new ethers.Wallet(ecdsaPrivateKey);

    const [elReader, elWriter] = await config.buildElClients(pkWallet);

    const [avsRegistryReader, avsRegistryWriter] = await config.buildAvsRegistryClients(elReader, pkWallet);

    return new Clients(
        avsRegistryReader,
        avsRegistryWriter,
        elReader,
        elWriter,
        ethHttpClient,
        pkWallet,
        null
    );
}
