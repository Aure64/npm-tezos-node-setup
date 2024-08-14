const inquirer = require('inquirer');
const { installTezosTools } = require('../lib/packageManager');
const { waitForIdentityFile, cleanNodeData, importSnapshot, getSnapshotSizes, cleanNodeDataBeforeImport } = require('../lib/snapshotManager');
const { exec, execSync } = require('child_process');
const os = require('os');
const path = require('path');
const configureServiceUnit = require('../lib/serviceManager');
const { checkPortInUse, detectExistingNodes } = require('../lib/detect');
const { updateClientConfig, checkNodeBootstrapped, handleKeyManagement } = require('../lib/bakerManager');
const fs = require('fs');
const downloadFile = require('../lib/downloadFile');

const BASE_DIR = os.homedir();

async function main() {
    console.log('Downloading and installing octez-client and octez-node...');
    await installTezosTools();

    console.log('Detecting existing Tezos nodes...');
    const existingNodes = detectExistingNodes();
    if (existingNodes.length > 0) {
        console.log('Existing Tezos nodes:');
        existingNodes.forEach(node => console.log(`- ${node}`));

        const { continueInstallation } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'continueInstallation',
                message: 'Tezos nodes are already running. Do you want to continue installing a new node?',
                default: false
            }
        ]);

        if (!continueInstallation) {
            console.log('Installation cancelled.');
            process.exit(0);
        }
    } else {
        console.log('No existing Tezos nodes found.');
    }

    // Asking user what they want to do (Node, Baker or Both)
    const { setupChoice } = await inquirer.prompt([
        {
            type: 'list',
            name: 'setupChoice',
            message: 'What would you like to setup?',
            choices: [
                { name: 'Node only', value: 'node' },
                { name: 'Baker only', value: 'baker' },
                { name: 'Node + Baker', value: 'node_baker' }
            ]
        }
    ]);

    const { network } = await inquirer.prompt([
        {
            type: 'list',
            name: 'network',
            message: 'Choose the network:',
            choices: ['mainnet', 'ghostnet']
        }
    ]);

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

    let rpcPort;
    let netPort;

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

    const { nodeName, customPath, snapshotMode } = await inquirer.prompt([
        {
            type: 'input',
            name: 'nodeName',
            message: 'Would you like to customize the node name? (leave blank for default name):',
            default: `${network}-node`
        },
        {
            type: 'input',
            name: 'customPath',
            message: 'Would you like to customize the node location? (leave blank for default location):',
            default: BASE_DIR
        },
        {
            type: 'list',
            name: 'snapshotMode',
            message: 'Choose the snapshot import mode:',
            choices: [
                { name: 'Safe mode', value: 'safe' },
                { name: 'Fast mode', value: 'fast' }
            ]
        }
    ]);

    const dataDir = path.join(customPath, nodeName);
    const fastMode = snapshotMode === 'fast';

    if (fs.existsSync(dataDir)) {
        console.log(`The directory ${dataDir} already exists.`);
        const { removeExisting } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'removeExisting',
                message: 'Would you like to remove the existing directory and continue?',
                default: false
            }
        ]);

        if (removeExisting) {
            fs.rmSync(dataDir, { recursive: true, force: true });
            console.log(`The directory ${dataDir} has been removed.`);
        } else {
            console.log('Installation cancelled.');
            process.exit(0);
        }
    }

    fs.mkdirSync(dataDir, { recursive: true });

    // Node Setup
    if (setupChoice === 'node' || setupChoice === 'node_baker') {
        await setupNode(network, mode, dataDir, fastMode, nodeName, rpcPort, netPort);
    }

    // Baker Setup
    if (setupChoice === 'baker' || setupChoice === 'node_baker') {
        await setupBaker(network, rpcPort);
    }

    console.log('Installation completed.');
    process.exit(0);
}

async function setupNode(network, mode, dataDir, fastMode, nodeName, rpcPort, netPort) {
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
            await importSnapshot(network, mode, dataDir, fastMode, snapshotPath);
            fs.unlinkSync(snapshotPath);
            break;
        } catch (error) {
            console.error(`Error importing snapshot: ${error.message}`);
            console.log('Attempting to clean and reimport snapshot...');
            cleanNodeData(dataDir);
        }
    }

    console.log(`Checking and stopping processes using port ${netPort}...`);
    const processes = execSync(`lsof -i :${netPort} -t`).toString().split('\n').filter(pid => pid);
    processes.forEach(pid => {
        try {
            execSync(`sudo kill ${pid}`);
            console.log(`Stopped process using port ${netPort}: ${pid}`);
        } catch (error) {
            console.error(`Error stopping process ${pid}: ${error.message}`);
        }
    });

    console.log('Configuring systemd service...');
    try {
        configureServiceUnit(dataDir, rpcPort, netPort, `octez-node-${nodeName}`);
        console.log('Systemd service configured successfully.');
    } catch (error) {
        console.error(`Error configuring systemd service: ${error.message}`);
        process.exit(1);
    }

    // Verify the status of the service
    try {
        const serviceStatus = execSync(`sudo systemctl is-active octez-node-${nodeName}`);
        if (serviceStatus.toString().trim() !== 'active') {
            throw new Error('The service did not start correctly');
        }
        console.log(`The service octez-node-${nodeName} started successfully.`);
    } catch (error) {
        console.error(`Error starting the service: ${error.message}`);
        process.exit(1);
    }
}

async function setupBaker(network, rpcPort) {
    console.log('Setting up baker...');

    // Update octez-client config to use the newly created node
    updateClientConfig(rpcPort);

    // Wait for the node to be bootstrapped
    checkNodeBootstrapped();

    // Handle key management (ask user to choose or create a key)
    await handleKeyManagement(network);
}

main();
