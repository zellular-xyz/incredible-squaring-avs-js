import { BlockNumber } from "eigensdk/types/general";
import { EventEmitter } from "events";
import Web3, { Contract, ContractAbi } from "web3";
import { timeout } from "./utils";
// import { Contract } from "web3-eth-contract";

interface PollerOptions {
    interval?: number; // polling interval in ms
    fromBlock?: BlockNumber; // optional starting block
}

type EventCallback<T = any> = (event: T) => void;

export class EventPoller<T extends ContractAbi> extends EventEmitter {
    private web3: any;
    private contract: Contract<T>;
    private _eventNames: string[];
    private options: PollerOptions = {
        interval: 5000,
        fromBlock: 0n
    };
    private timer: NodeJS.Timeout | null = null;
    private running: boolean;

    constructor(web3: any, contract: Contract<T>, eventNames: string[], options: PollerOptions = {}) {
        super();
        this.web3 = web3;
        this.contract = contract;
        this._eventNames = eventNames;
        this.options = {
            ...this.options,
            ...options
        }
        this.running = false;
    }

    public async start() {
        if (this.running)
            return;
        this.running = true;
        
        let lastBlock = this.options.fromBlock
        while(this.running) {
            try {
                console.log("============================== polling events: ", this._eventNames)
                const currentBlock = await this.web3.eth.getBlockNumber();
                
                const events = await Promise.all(this._eventNames.map(eventName => {
                    return this.contract.getPastEvents(eventName, {
                        fromBlock: lastBlock! + 1n,
                        toBlock: currentBlock,
                    });
                }))

                for(let i in this._eventNames) {
                    if (events[i].length > 0) {
                        events[i].forEach((ev) => this.emit(this._eventNames[i], ev));
                    }
                }

                lastBlock = currentBlock;
            } catch (err) {
                this.emit("error", err);
            }
            await timeout(this.options.interval!)
        };
    }

    // public async start() {
    //     if (this.timer) return;

    //     this.timer = setInterval(async () => {
    //         try {
    //             const currentBlock = await this.web3.eth.getBlockNumber();

    //             const events = await this.contract.getPastEvents(this.eventName, {
    //                 fromBlock: this.lastBlock + 1,
    //                 toBlock: currentBlock,
    //             });

    //             if (events.length > 0) {
    //                 events.forEach((ev) => this.emit("data", ev));
    //             }

    //             this.lastBlock = currentBlock;
    //         } catch (err) {
    //             this.emit("error", err);
    //         }
    //     }, this.interval);
    // }

    public stop() {
        if (this.running) {
            this.running = false;
        }
    }
}

export function createEventPoller<T extends ContractAbi>(
    web3: Web3,
    contract: Contract<T>,
    eventName: string,
    callback: EventCallback,
    pollInterval = 5000 // default: 5 seconds
) {
    let lastBlock = 0n;
    let timer: NodeJS.Timeout | null = null;

    async function poll() {
        try {
            const currentBlock: BlockNumber = await web3.eth.getBlockNumber();

            if (lastBlock === 0n) {
                lastBlock = currentBlock; // skip past history on first run
                return;
            }

            if (currentBlock > lastBlock) {
                const events = await contract.getPastEvents(eventName, {
                    fromBlock: lastBlock + 1n,
                    toBlock: currentBlock,
                });

                for (const evt of events) {
                    callback(evt);
                }

                lastBlock = currentBlock;
            }
        } catch (err) {
            console.error(`Polling error for event ${eventName}:`, err);
        }
    }

    return {
        start() {
            if (!timer) {
                poll(); // run immediately once
                timer = setInterval(poll, pollInterval);
            }
        },
        stop() {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        },
    };
}
