import { Histogram, Counter, Registry } from 'prom-client';

export class Collector {
    private rpcRequestDurationSeconds: Histogram<string>;
    private rpcRequestTotal: Counter<string>;

    constructor(avsName: string, registry: Registry = new Registry()) {
        this.rpcRequestDurationSeconds = new Histogram({
            name: 'eigen_prom_namespace_rpc_request_duration_seconds',
            help: 'Duration of json-rpc <method> in seconds',
            labelNames: ['method', 'client_version', 'avs_name'],
            registers: [registry],
        });

        this.rpcRequestTotal = new Counter({
            name: 'eigen_prom_namespace_rpc_request_total',
            help: 'Total number of json-rpc <method> requests',
            labelNames: ['method', 'client_version', 'avs_name'],
            registers: [registry],
        });

        // Set avs_name label value
        this.rpcRequestDurationSeconds.labels({ avs_name: avsName });
        this.rpcRequestTotal.labels({ avs_name: avsName });
    }

    public observeRpcRequestDurationSeconds(duration: number, method: string, clientVersion: string): void {
        this.rpcRequestDurationSeconds.labels(method, clientVersion).observe(duration);
    }

    public addRpcRequestTotal(method: string, clientVersion: string): void {
        this.rpcRequestTotal.labels(method, clientVersion).inc();
    }
}

/**
Usage example:
const registry = new Registry();
const collector = new Collector('example_avs', registry);
collector.observeRpcRequestDurationSeconds(0.5, 'eth_getBlockByNumber', '1.0.0');
collector.addRpcRequestTotal('eth_getBlockByNumber', '1.0.0');
*/