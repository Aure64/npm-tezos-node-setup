const fs = require('fs');
const path = require('path');
const axios = require('axios');
const inquirer = require('inquirer');
const { exec, execSync } = require('child_process');
const os = require('os');
const { installTezosNode, installTezosBaker } = require('../lib/packageManager');
const { waitForIdentityFile, cleanNodeData, cleanNodeDataBeforeImport, importSnapshot, getSnapshotSizes } = require('../lib/snapshotManager');
const { configureServiceUnit } = require('../lib/serviceManager');
const { checkPortInUse, detectExistingNodes } = require('../lib/detect');
const { setupBaker } = require('../lib/bakerManager');
const { parseNodeProcess, getNodeNetwork } = require('../lib/nodeManager');
const downloadFile = require('../lib/downloadFile');

const BASE_DIR = os.homedir();

async function main() {
    await installTezosNode();

    console.log('Detecting existing Tezos nodes...');
    const existingNodes = detectExistingNodes();

    let rpcPort;
    let netPort;
    let network;
    let dataDir;

    if (existingNodes.length > 0) {
        console.log('Existing Tezos nodes:');
        existingNodes.forEach(node => console.log(`- ${node}`));

        const { setupBakerOption } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'setupBakerOption',
                message: 'Tezos nodes are already running. Do you want to set up a baker on the existing node?',
                default: true
            }
        ]);

        if (setupBakerOption) {
            const { rpcPort: detectedRpcPort, dataDir: detectedDataDir } = parseNodeProcess(existingNodes[0]);
            rpcPort = detectedRpcPort;
            dataDir = detectedDataDir;
            network = getNodeNetwork(dataDir);

            const protocolHash = await getCurrentProtocol(rpcPort);
            await installTezosBaker(protocolHash);

            console.log(`Setting up a baker on the existing node using RPC port ${rpcPort} and network ${network}...`);
            await setupBaker(dataDir, rpcPort, network);
            return;
        }

        const { setupNewNode } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'setupNewNode',
                message: 'Do you want to create a new Tezos node?',
                default: false
            }
        ]);

        if (!setupNewNode) {
            console.log('Installation cancelled.');
            process.exit(0);
        }
    } else {
        console.log('No existing Tezos nodes found.');
    }

    const { setupType } = await inquirer.prompt([
        {
            type: 'list',
            name: 'setupType',
            message: 'What would you like to set up?',
            choices: [
                { name: 'Node only', value: 'nodeOnly' },
                { name: 'Node + Baker', value: 'nodeAndBaker' },
                { name: 'Baker only (on an existing node)', value: 'bakerOnly' }
            ]
        }
    ]);

    if (setupType === 'bakerOnly') {
        console.log('Please provide the details of the existing node to set up the baker.');

        const { rpcPort: detectedRpcPort, dataDir: detectedDataDir } = parseNodeProcess(existingNodes[0]);
        rpcPort = detectedRpcPort;
        dataDir = detectedDataDir;
        network = getNodeNetwork(dataDir);

        const protocolHash = await getCurrentProtocol(rpcPort);
        await installTezosBaker(protocolHash);

        console.log(`Setting up a baker on the existing node using RPC port ${rpcPort}, data directory ${dataDir}, and network ${network}...`);
        await setupBaker(dataDir, rpcPort, network);
        return;
    }

    const { networkAnswer } = await inquirer.prompt([
        {
            type: 'list',
            name: 'networkAnswer',
            message: 'Choose the network:',
            choices: ['mainnet', 'ghostnet']
        }
    ]);
    network = networkAnswer;

    const snapshotSizes = await getSnapshotSizes(network);

    const { mode } = await inquirer.prompt([
        {
            type: 'list',
            name: 'mode',
            message: 'Choose the mode:',
            choices: [
                { name: `full (${snapshotSizes.full} GB)`, value: 'full' },
                { name: `rolling (${snapshotSizes.rolling} GB)`, value: 'rolling' }
            ]
        }
    ]);

    const { fastMode } = await inquirer.prompt([
        {
            type: 'list',
            name: 'fastMode',
            message: 'Choose the import mode:',
            choices: [
                { name: 'Fast mode (no checks)', value: true },
                { name: 'Safe mode (with checks)', value: false }
            ]
        }
    ]);

    while (true) {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'rpcPort',
                message: 'Enter the RPC port to use (or press Enter to use the default port 8732):',
                default: '8732'
            },
            {
                type: 'input',
                name: 'netPort',
                message: 'Enter the network port to use (or press Enter to use the default port 9732):',
                default: '9732'
            }
        ]);

        const rpcPortInUse = await checkPortInUse(answers.rpcPort);
        const netPortInUse = await checkPortInUse(answers.netPort);

        if (rpcPortInUse) {
            console.log(`RPC port ${answers.rpcPort} is already in use. Please choose another port.`);
        } else if (netPortInUse) {
            console.log(`Network port ${answers.netPort} is already in use. Please choose another port.`);
        } else {
            rpcPort = answers.rpcPort;
            netPort = answers.netPort;
            break;
        }
    }

    while (true) {
        const { dirName, dirPath } = await inquirer.prompt([
            {
                type: 'input',
                name: 'dirName',
                message: 'Enter the name for the data directory (default is tezos-node):',
                default: 'tezos-node',
            },
            {
                type: 'input',
                name: 'dirPath',
                message: 'Enter the path where the directory should be created:',
                default: BASE_DIR,
            },
        ]);

        dataDir = path.join(dirPath, dirName);

        if (fs.existsSync(dataDir)) {
            console.log(`The directory ${dataDir} already exists.`);
            const { action } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'action',
                    message: `The directory ${dataDir} already exists. What would you like to do?`,
                    choices: [
                        { name: 'Remove the existing directory', value: 'remove' },
                        { name: 'Choose a different directory', value: 'newDir' },
                        { name: 'Cancel installation', value: 'cancel' },
                    ],
                },
            ]);

            if (action === 'remove') {
                try {
                    fs.rmSync(dataDir, { recursive: true, force: true });
                    console.log(`Directory ${dataDir} removed successfully.`);
                    break;
                } catch (error) {
                    console.error(`Failed to remove the directory: ${error.message}`);
                    const { retry } = await inquirer.prompt([
                        {
                            type: 'confirm',
                            name: 'retry',
                            message: 'Do you want to try a different directory?',
                            default: true,
                        },
                    ]);
                    if (!retry) {
                        console.log('Installation cancelled.');
                        process.exit(0);
                    }
                }
            } else if (action === 'newDir') {
                continue;
            } else {
                console.log('Installation cancelled.');
                process.exit(0);
            }
        } else {
            fs.mkdirSync(dataDir, { recursive: true });
            break;
        }
    }

    while (true) {
        try {
            console.log('Initializing the node...');
            execSync(`octez-node config init --data-dir "${dataDir}" --network=${network} --history-mode=${mode}`);
            console.log('Starting the node to create identity...');
            const nodeProcess = exec(`octez-node run --data-dir "${dataDir}"`);

            try {
                await waitForIdentityFile(dataDir);
                console.log('Identity created, stopping the node...');
                nodeProcess.kill('SIGINT');
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait to ensure the process is fully stopped
                break;
            } catch (error) {
                console.error(error.message);
                console.log('Cleaning node data...');
                cleanNodeData(dataDir);
                console.log('Reinitializing...');
            }
        } catch (error) {
            console.error(`Error initializing the node: ${error.message}`);
            process.exit(1);
        }
    }

    const snapshotPath = '/tmp/snapshot';

    while (true) {
        try {
            console.log(`Downloading snapshot from https://snapshots.eu.tzinit.org/${network}/${mode}...`);
            await downloadFile(`https://snapshots.eu.tzinit.org/${network}/${mode}`, snapshotPath);
            break;
        } catch (error) {
            console.error(`Error downloading snapshot: ${error.message}`);
        }
    }

    while (true) {
        try {
            console.log('Cleaning files before snapshot import...');
            cleanNodeDataBeforeImport(dataDir);
            await importSnapshot(network, mode, dataDir, fastMode, snapshotPath, netPort);
            fs.unlinkSync(snapshotPath);
            break;
        } catch (error) {
            console.error(`Error importing snapshot: ${error.message}`);
            console.log('Attempting to clean and reimport snapshot...');
            cleanNodeData(dataDir);
        }
    }

    console.log('Configuring systemd service...');
    try {
        configureServiceUnit(dataDir, rpcPort, netPort, 'octez-node');
        console.log('Systemd service configured successfully.');
    } catch (error) {
        console.error(`Error configuring systemd service: ${error.message}`);
        process.exit(1);
    }

    // Wait for the node to fully bootstrap before proceeding
    console.log('Waiting for the node to fully bootstrap...');
    await waitForNodeToBootstrap(rpcPort);

    // Get the current protocol after bootstrapping
    const protocolHash = await getCurrentProtocol(rpcPort);

    if (setupType === 'nodeAndBaker') {
        console.log('Setting up baker...');
        await installTezosBaker(protocolHash);
        await setupBaker(dataDir, rpcPort, network);
    }

    console.log('Installation completed.');
    process.exit(0);
}

async function waitForNodeToBootstrap(rpcPort) {
    while (true) {
        try {
            const response = await axios.get(`http://127.0.0.1:${rpcPort}/chains/main/blocks/head/header`);
            if (response.data.chain_status === 'synced') {
                console.log('Node is fully bootstrapped.');
                break;
            } else {
                console.log('Node is still bootstrapping...');
            }
        } catch (error) {
            console.error('Failed to retrieve node status, retrying...');
        }
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait for 10 seconds before checking again
    }
}

async function getCurrentProtocol(rpcPort) {
    try {
        const response = await axios.get(`http://127.0.0.1:${rpcPort}/chains/main/blocks/head`);
        return response.data.protocol;
    } catch (error) {
        console.error('Failed to retrieve current protocol:', error.message);
        throw error;
    }
}

main();
