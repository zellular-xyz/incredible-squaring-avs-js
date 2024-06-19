import { Gauge, Counter, Registry, collectDefaultMetrics, register } from 'prom-client';
import { Logger } from 'pino'; // Assuming you use winston for logging
import { ELReader } from '../../../chainio/clients/elcontracts/reader.js';
import { AvsRegistryReader } from '../../../chainio/clients/avsregistry/reader.js';

export class Collector {
    private elReader: ELReader;
    private avsRegistryReader: AvsRegistryReader;
    private logger: Logger;
    private operatorAddr: string;
    private operatorId: string | null;
    private quorumNames: { [key: string]: string };

    private slashingStatus: Counter<string>;
    private registeredStake: Gauge<string>;

    constructor(
        elReader: ELReader,
        avsRegistryReader: AvsRegistryReader,
        avsName: string,
        logger: Logger,
        operatorAddr: string,
        quorumNames: { [key: string]: string }
    ) {
        this.elReader = elReader;
        this.avsRegistryReader = avsRegistryReader;
        this.logger = logger;
        this.operatorAddr = operatorAddr;
        this.operatorId = null;
        this.quorumNames = quorumNames;

        this.slashingStatus = new Counter({
            name: 'eigen_slashing_status',
            help: 'Whether the operator has been slashed',
            registers: [register],
        });

        this.registeredStake = new Gauge({
            name: 'eigen_registered_stakes',
            help: `Operator stake in <quorum> of ${avsName}'s StakeRegistry contract`,
            labelNames: ['quorum_number', 'quorum_name'],
            registers: [register],
        });
    }

    private initOperatorId(): boolean {
        if (this.operatorId === null) {
            this.operatorId = this.avsRegistryReader.getOperatorId(this.operatorAddr);
        }
        return this.operatorId !== null; // true means success
    }

    public async collect(): Promise<void> {
        // Collect slashingStatus metric
        const operatorIsFrozen = await this.elReader.operatorIsFrozen(this.operatorAddr);
        if (operatorIsFrozen === null) {
            this.logger.error('Failed to get slashing incurred');
        } else {
            const operatorIsFrozenValue = operatorIsFrozen ? 1.0 : 0.0;
            this.slashingStatus.inc(operatorIsFrozenValue);
        }

        // Collect registeredStake metric
        if (!this.initOperatorId()) {
            this.logger.warn('Failed to fetch and cache operator id. Skipping collection of registeredStake metric.');
        } else {
            const quorumStakeMap = await this.avsRegistryReader.getOperatorStakeInQuorums(this.operatorId);
            for (const [quorumNum, stake] of Object.entries(quorumStakeMap)) {
                const stakeValue = parseFloat(stake as string);
                this.registeredStake.labels(quorumNum.toString(), this.quorumNames[quorumNum]).set(stakeValue);
            }
        }
    }
}
