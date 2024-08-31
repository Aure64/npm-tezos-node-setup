const fs = require('fs');
const path = require('path');
const axios = require('axios');
const inquirer = require('inquirer');
const { exec, execSync } = require('child_process');
const os = require('os');
const { installTezosNode, installTezosBaker, installZcashParams } = require('../lib/packageManager');
const { waitForIdentityFile, cleanNodeData, cleanNodeDataBeforeImport, importSnapshot, getSnapshotSizes } = require('../lib/snapshotManager');
const { configureServiceUnit } = require('../lib/serviceManager');
const { checkPortInUse, detectExistingNodes } = require('../lib/detect');
const { setupBaker, getTzAddress } = require('../lib/bakerManager');
const { parseNodeProcess, getNodeNetwork, waitForNodeToBootstrap, getCurrentProtocol } = require('../lib/nodeManager');
const downloadFile = require('../lib/downloadFile');
const { postBakerSetup } = require('../lib/monitoringManager');


const BASE_DIR = os.homedir();

async function main() {
    // Install Zcash parameters if they are not already present
    await installZcashParams();

    // Install or update the Tezos node binaries
    await installTezosNode();

    console.log('Detecting existing Tezos nodes...');
    const existingNodes = detectExistingNodes(); // Detect existing Tezos nodes running on the system

    let rpcPort;
    let netPort;
    let network;
    let dataDir;

    if (existingNodes.length > 0) {
        console.log('Existing Tezos nodes:');
        existingNodes.forEach(node => console.log(`- ${node}`));

        // Prompt the user to set up a baker on the existing node
        const { setupBakerOption } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'setupBakerOption',
                message: 'Tezos nodes are already running. Do you want to set up a baker on the existing node?',
                default: true
            }
        ]);

        if (setupBakerOption) {
            // Extract information about the running node
            const { rpcPort: detectedRpcPort, dataDir: detectedDataDir } = parseNodeProcess(existingNodes[0]);
            rpcPort = detectedRpcPort;
            dataDir = detectedDataDir;
            network = getNodeNetwork(dataDir);

            // Retrieve the current protocol for the node
            let protocolHash;
            try {
                protocolHash = await getCurrentProtocol(rpcPort);
                console.log(`Current protocol: ${protocolHash}`);
            } catch (error) {
                console.error(`Could not retrieve the current protocol after several attempts: ${error.message}`);
                process.exit(1);
            }

            // Install and configure the baker service
            await installTezosBaker(protocolHash);
            console.log(`Setting up a baker on the existing node using RPC port ${rpcPort} and network ${network}...`);
            await setupBaker(dataDir, rpcPort, network);
            const tzAddress = getTzAddress();
            console.log(`Final chosen tzAddress: ${tzAddress}`);
            await postBakerSetup(tzAddress);
            return;
        }

        if (setupType === 'monitorOnly') {
            // For monitoring only, get the tzAddress and proceed directly to setup monitoring
            console.log('Please provide the details of the baker you wish to monitor.');

            const { rpcPort: detectedRpcPort, dataDir: detectedDataDir } = parseNodeProcess(existingNodes[0]);
            rpcPort = detectedRpcPort;
            dataDir = detectedDataDir;
            network = getNodeNetwork(dataDir);

            let tzAddress;
            const { address } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'address',
                    message: 'Enter the tzAddress of the baker you want to monitor:',
                    validate: input => input.startsWith('tz1') || 'Address must start with tz1'
                }
            ]);

            tzAddress = address;
            console.log(`Final chosen tzAddress: ${tzAddress}`);

            await postBakerSetup(tzAddress);
            return;
        }


        // Ask if the user wants to create a new Tezos node
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

    // Prompt user to select the setup type: Node only, Node + Baker, or Baker only
    const { setupType } = await inquirer.prompt([
        {
            type: 'list',
            name: 'setupType',
            message: 'What would you like to set up?',
            choices: [
                { name: 'Node only', value: 'nodeOnly' },
                { name: 'Node + Baker', value: 'nodeAndBaker' },
                { name: 'Baker only (on an existing node)', value: 'bakerOnly' },
                { name: 'Monitor only', value: 'monitorOnly' }
            ]
        }
    ]);

    if (setupType === 'bakerOnly') {
        console.log('Please provide the details of the existing node to set up the baker.');

        const { rpcPort: detectedRpcPort, dataDir: detectedDataDir } = parseNodeProcess(existingNodes[0]);
        rpcPort = detectedRpcPort;
        dataDir = detectedDataDir;
        network = getNodeNetwork(dataDir);

        let protocolHash;
        try {
            protocolHash = await getCurrentProtocol(rpcPort);
            console.log(`Current protocol: ${protocolHash}`);
        } catch (error) {
            console.error(`Could not retrieve the current protocol after several attempts: ${error.message}`);
            process.exit(1);
        }

        await installTezosBaker(protocolHash);
        console.log(`Setting up a baker on the existing node using RPC port ${rpcPort}, data directory ${dataDir}, and network ${network}...`);
        await setupBaker(dataDir, rpcPort, network);
        const tzAddress = getTzAddress();
        console.log(`Final chosen tzAddress: ${tzAddress}`);

        await postBakerSetup(tzAddress);
        return;
    }

    // Ask user to choose the Tezos network
    const { networkAnswer } = await inquirer.prompt([
        {
            type: 'list',
            name: 'networkAnswer',
            message: 'Choose the network:',
            choices: ['mainnet', 'ghostnet']
        }
    ]);
    network = networkAnswer;

    // Fetch available snapshot sizes for the selected network
    const snapshotSizes = await getSnapshotSizes(network);

    // Prompt the user to choose the history mode for the node
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

    // Ask the user if they want to import the snapshot in fast or safe mode
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

    // Select RPC and network ports, ensuring they are not already in use
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

    // Determine where to create the data directory and handle potential conflicts
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

    const serviceName = path.basename(dataDir); // Use the directory name as the service name

    // Initialize and configure the Tezos node
    while (true) {
        try {
            console.log('Initializing the node...');
            execSync(`octez-node config init --data-dir "${dataDir}" --network=${network} --history-mode=${mode}`);
            console.log('Starting the node to create identity...');
            const nodeProcess = exec(`octez-node run --data-dir "${dataDir}"`);

            try {
                await waitForIdentityFile(dataDir); // Wait for the identity file to be created
                console.log('Identity created, stopping the node...');
                nodeProcess.kill('SIGINT'); // Stop the node
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

    // Download and import the snapshot for faster node setup
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
            fs.unlinkSync(snapshotPath); // Remove the snapshot file after import
            break;
        } catch (error) {
            console.error(`Error importing snapshot: ${error.message}`);
            console.log('Attempting to clean and reimport snapshot...');
            cleanNodeData(dataDir);
        }
    }

    // Configure the node as a systemd service
    console.log('Configuring systemd service...');
    try {
        configureServiceUnit(dataDir, rpcPort, netPort, serviceName);
        console.log('Systemd service configured successfully.');
    } catch (error) {
        console.error(`Error configuring systemd service: ${error.message}`);
        process.exit(1);
    }

    // Wait for the node to fully bootstrap before proceeding
    await waitForNodeToBootstrap(rpcPort);

    // Get the current protocol after bootstrapping
    let protocolHash;
    try {
        protocolHash = await getCurrentProtocol(rpcPort);
        console.log(`Current protocol: ${protocolHash}`);
    } catch (error) {
        console.error(`Could not retrieve the current protocol after several attempts: ${error.message}`);
        process.exit(1);
    }

    // If the user chose to set up a baker, proceed with the setup
    if (setupType === 'nodeAndBaker') {
        console.log('Setting up baker...');
        await installTezosBaker(protocolHash);
        await setupBaker(dataDir, rpcPort, network);
        await postBakerSetup(tzAddress);
    }

    console.log('Installation completed.');
    process.exit(0);
}

main();
