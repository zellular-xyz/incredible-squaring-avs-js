
export class AsyncQueue {
	queue: any[]
	resolveQueue: any[]

    constructor() {
        this.queue = [];
        this.resolveQueue = [];
    }

    async enqueue(item:any) {
        if (this.resolveQueue.length > 0) {
            const resolve = this.resolveQueue.shift();
            resolve({ value: item, done: false });
        } else {
            this.queue.push(item);
        }
    }

    async dequeue() {
        return new Promise(resolve => {
            if (this.queue.length > 0) {
                const item = this.queue.shift();
                resolve({ value: item, done: false });
            } else {
                this.resolveQueue.push(resolve);
            }
        });
    }

    async *[Symbol.asyncIterator]() {
        while (true) {
            const item:any = await this.dequeue();
            if (item.done) return;
            yield item.value;
        }
    }

    close() {
        while (this.resolveQueue.length > 0) {
            const resolve = this.resolveQueue.shift();
            resolve({ value: undefined, done: true });
        }
    }
}

// // Example usage
// async function producer(queue) {
//     for (let i = 1; i <= 5; i++) {
//         console.log(`Producing item ${i}`);
//         await queue.enqueue(i);
//         await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate async operation
//     }
//     queue.close(); // Signal the consumer that production is done
// }

// async function consumer(queue) {
//     for await (const item of queue) {
//         console.log(`Consuming item ${item}`);
//         await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate async operation
//     }
//     console.log('All items consumed');
// }

// const queue = new AsyncQueue();
// producer(queue);
// consumer(queue);
