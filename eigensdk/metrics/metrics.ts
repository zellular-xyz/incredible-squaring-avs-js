export abstract class Metrics {
    abstract AddFeeEarnedTotal(amount: number, token: string): void;

    abstract SetPerformanceScore(score: number): void;

    abstract Start(): void;
}