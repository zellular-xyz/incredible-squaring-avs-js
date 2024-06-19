import { Counter, Gauge, Registry } from 'prom-client';
import { FastifyInstance, fastify } from 'fastify';
import {pino, Logger} from 'pino';

// Constants
const EIGEN_PROM_NAMESPACE = 'eigen';

export class EigenMetrics {
    private ipPortAddress: string;
    private logger: Logger;
    private registry: Registry;
    private feeEarnedTotal: Counter<string>;
    private performanceScore: Gauge<string>;

    constructor(avsName: string, ipPortAddress: string, logger: Logger, registry: Registry = new Registry()) {
        this.ipPortAddress = ipPortAddress;
        this.logger = logger;
        this.registry = registry;

        // Metrics
        this.feeEarnedTotal = new Counter({
            name: `${EIGEN_PROM_NAMESPACE}_fees_earned_total`,
            help: 'The amount of fees earned in <token>',
            labelNames: ['token'],
            registers: [this.registry],
        });

        this.performanceScore = new Gauge({
            name: `${EIGEN_PROM_NAMESPACE}_performance_score`,
            help: 'The performance metric is a score between 0 and 100 and each developer can define their own way of calculating the score. The score is calculated based on the performance of the Node and the performance of the backing services.',
            registers: [this.registry],
        });

        this.initMetrics();
    }

    private initMetrics() {
        // Performance score starts as 100, and goes down if node doesn't perform well
        this.performanceScore.set(100);
        // TODO: Initialize fee_earned_total if needed
    }

    public addFeeEarnedTotal(amount: number, token: string) {
        this.feeEarnedTotal.inc({ token: token }, amount);
    }

    public setPerformanceScore(score: number) {
        this.performanceScore.set(score);
    }

    public async start() {
        this.logger.info(`Starting metrics server at port ${this.ipPortAddress}`);
        const app: FastifyInstance = fastify();

        // Expose the metrics endpoint
        app.get('/metrics', async (request, reply) => {
            reply.type('text/plain');
            return this.registry.metrics();
        });

        try {
            const [host, port] = this.ipPortAddress.split(':');
            await app.listen({ port: Number.parseInt(port), host });
        } catch (e) {
            this.logger.error(`Prometheus server failed: ${e}`);
        }
	}
}
 

// Usage example
const usageExample = async () => {
    const logger = pino({ level: 'info' });
    const metrics = new EigenMetrics('example_avs', '0.0.0.0:8000', logger);
    await metrics.start();
};

// // Check if the script is being executed directly
// if (require.main === module) {
//     main();
// }
