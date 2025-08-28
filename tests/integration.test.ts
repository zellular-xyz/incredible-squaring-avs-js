// testIncredibleSquaringE2E.ts
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

// Assuming you have these classes in TS (adjust imports as needed)
import { init as initializeMcl } from "eigensdk/crypto/bls/attestation"
import { SquaringOperator } from "../operator";
import { Challenger } from "../challenger";
import { MockAggregator } from "./mocks";
// import { initializeMcl } from "mcl-wasm/dist/mcl";

// ----------------------
// Helper functions
// ----------------------

function startAnvilAndDeployContracts(): ChildProcessWithoutNullStreams {
    const anvilProcess = spawn("anvil", [
        "--load-state",
        "tests/anvil/avs-and-eigenlayer-deployed-anvil-state/state.json",
        "--print-traces",
        "-vvvvv",
    ], {
        stdio: "ignore", // equivalent to DEVNULL
    });
    return anvilProcess;
}

async function startOperator(number: number) {
    const dirPath = __dirname;
    const operatorConfigPath = path.join(dirPath, `../config-files/operator${number}.yaml`);
    if (!fs.existsSync(operatorConfigPath)) {
        throw new Error(`Config file not found at: ${operatorConfigPath}`);
    }
    const operatorConfig = yaml.load(fs.readFileSync(operatorConfigPath, "utf8")) as Record<string, any>;

    const avsConfigPath = path.join(dirPath, "../config-files/avs.yaml");
    if (!fs.existsSync(avsConfigPath)) {
        throw new Error(`Config file not found at: ${avsConfigPath}`);
    }
    const avsConfig = yaml.load(fs.readFileSync(avsConfigPath, "utf8")) as Record<string, any>;

    const operator = new SquaringOperator({ ...operatorConfig, ...avsConfig });
    await operator.init();

    // mimic Python thread with a background async start
    const operatorThread = (async () => {
        await operator.start();
    })();

    return { operator, operatorThread };
}

async function startAggregator() {
    const dirPath = __dirname;
    const aggregatorConfigPath = path.join(dirPath, "../config-files/aggregator.yaml");
    if (!fs.existsSync(aggregatorConfigPath)) {
        throw new Error(`Config file not found at: ${aggregatorConfigPath}`);
    }
    const aggregatorConfig = yaml.load(fs.readFileSync(aggregatorConfigPath, "utf8")) as Record<string, any>;

    const avsConfigPath = path.join(dirPath, "../config-files/avs.yaml");
    if (!fs.existsSync(avsConfigPath)) {
        throw new Error(`Config file not found at: ${avsConfigPath}`);
    }
    const avsConfig = yaml.load(fs.readFileSync(avsConfigPath, "utf8")) as Record<string, any>;

    const aggregator = new MockAggregator({ ...aggregatorConfig, ...avsConfig });
    await aggregator.init();

    const aggregatorThread = (async () => {
        await aggregator.start();
    })();

    return { aggregator, aggregatorThread };
}

async function startChallenger() {
    const dirPath = __dirname;
    const challengerConfigPath = path.join(dirPath, "../config-files/challenger.yaml");
    if (!fs.existsSync(challengerConfigPath)) {
        throw new Error(`Config file not found at: ${challengerConfigPath}`);
    }
    const challengerConfig = yaml.load(fs.readFileSync(challengerConfigPath, "utf8")) as Record<string, any>;

    const avsConfigPath = path.join(dirPath, "../config-files/avs.yaml");
    if (!fs.existsSync(avsConfigPath)) {
        throw new Error(`Config file not found at: ${avsConfigPath}`);
    }
    const avsConfig = yaml.load(fs.readFileSync(avsConfigPath, "utf8")) as Record<string, any>;

    const challenger = new Challenger({ ...challengerConfig, ...avsConfig });
    await challenger.init();

    const challengerThread = (async () => {
        await challenger.start();
    })();

    return { challenger, challengerThread };
}

// ----------------------
// Test function
// ----------------------

export async function testIncredibleSquaringE2E() {
    await initializeMcl()

    console.log("Starting anvil ...");
    const anvilProcess = startAnvilAndDeployContracts();
    console.log("Anvil started.");

    console.log("Starting operators ...");
    const opStarts = await Promise.all([1, 2, 3].map(i => startOperator(i)))
    const operators: SquaringOperator[] = opStarts.map(({operator}) => operator);
    const operatorThreads: Promise<void>[] = opStarts.map(({operatorThread}) => operatorThread);
    console.log("Operators started.");

    console.log("Starting aggregator ...");
    const { aggregator, aggregatorThread } = await startAggregator();
    console.log("Aggregator started.");

    // console.log("Starting challenger ...");
    // const { challenger, challengerThread } = await startChallenger();
    // console.log("Challenger started.");

    try {
        console.log("Waiting for 10 seconds...");
        await new Promise((res) => setTimeout(res, 10000));

        console.log("\nChecking task manager");
        const taskManager = aggregator.taskManager!;
        const taskHash:string = await taskManager.methods.allTaskHashes(0).call();
        const taskResponseHash:string = await taskManager.methods.allTaskResponses(0).call();

        console.log("Task hash:", taskHash);
        console.log("Task response hash:", taskResponseHash);

        const emptyBytes = "0x" + "00".repeat(32);
        if (taskHash === emptyBytes) throw new Error("Task hash is empty");
        if (taskResponseHash === emptyBytes) throw new Error("Task response hash is empty");

        // console.log("\nRetrieving task and response from challenger");
        // const task = challenger.tasks[0];
        // const taskResponse = challenger.taskResponses[0];
        // const challengeHash = challenger.challengeHashes[0];

        // if (!task) throw new Error("Task not found in challenger");
        // if (!taskResponse) throw new Error("Task response not found in challenger");

        // console.log("\nTask:");
        // // console.log(JSON.stringify(task.to_json(), null, 2));
        // console.log(JSON.stringify(task, null, 2));

        // console.log("\nTask Response:");
        // // console.log(JSON.stringify(taskResponse.to_json(), null, 2));
        // console.log(JSON.stringify(taskResponse, null, 2));

        // const correctResult = task.numberToBeSquared ** 2;
        // const actualResult = taskResponse.taskResponse.numberSquared;
        // const isResponseWrong = actualResult !== correctResult;

        // if (isResponseWrong && !challengeHash) {
        //     throw new Error("Response is wrong, but no challenge was raised");
        // } else if (!isResponseWrong && challengeHash) {
        //     throw new Error("Response is correct, but a challenge was raised");
        // }

        // console.log("\n================================================");
        // console.log(`Task: square ${task.numberToBeSquared} (block ${task.taskCreatedBlock})`);
        // console.log(`Response: ${actualResult} (block ${taskResponse.taskResponseMetadata.taskResponsedBlock})`);
        // if (isResponseWrong) {
        //     console.log(`Response was incorrect. Challenge raised: ${challengeHash}`);
        // } else {
        //     console.log("Response was correct. No challenge raised.");
        // }
        // console.log("PASSED");
        // console.log("================================================");
    } finally {
        console.log("\nCleaning up processes...");
        for (const operator of operators) {
            operator.stop();
        }
        aggregator.stop();
        // challenger.stop();

        await Promise.all(operatorThreads);
        // await challengerThread;
        anvilProcess.kill();
        console.log("Cleanup complete");
    }
}

// Run directly if invoked as script
if (require.main === module) {
    testIncredibleSquaringE2E()
        .catch((err) => {
            console.error("Test failed:", err);
            process.exit(1);
        })
}
