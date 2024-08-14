// bin/main.js
const inquirer = require('inquirer');
const { installTezosTools } = require('../lib/packageManager');
const { waitForIdentityFile, cleanNodeData, importSnapshot, getSnapshotSizes, cleanNodeDataBeforeImport } = require('../lib/snapshotManager');
const { exec, execSync } = require('child_process');
const os = require('os');
const path = require('path');
const configureServiceUnit = require('../lib/serviceManager');
const { checkPortInUse, detectExistingNodes } = require('../lib/detect');
const { setupBaker } = require('../lib/bakerManager');
const fs = require('fs');
const downloadFile = require('../lib/downloadFile');

const BASE_DIR = os.homedir();

async function main() {
    console.log('Downloading and installing octez-client and octez-node...');
    await installTezosTools();

    console.log('Detecting existing Tezos nodes...');
    const existingNodes = detectExistingNodes();

    let rpcPort;
    let netPort;
    let network;

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
            const { rpcPortAnswer, netPortAnswer, networkAnswer } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'rpcPortAnswer',
                    message: 'Enter the RPC port of the existing node (default is 8732):',
                    default: '8732'
                },
                {
                    type: 'input',
                    name: 'netPortAnswer',
                    message: 'Enter the network port of the existing node (default is 9732):',
                    default: '9732'
                },
                {
                    type: 'list',
                    name: 'networkAnswer',
                    message: 'Choose the network of the existing node:',
                    choices: ['mainnet', 'ghostnet']
                }
            ]);

            rpcPort = rpcPortAnswer;
            netPort = netPortAnswer;
            network = networkAnswer;

            console.log('Setting up a baker on the existing node...');
            await setupBaker(rpcPort, network);
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
        const { rpcPortAnswer, netPortAnswer, networkAnswer } = await inquirer.prompt([
            {
                type: 'input',
                name: 'rpcPortAnswer',
                message: 'Enter the RPC port of the existing node (default is 8732):',
                default: '8732'
            },
            {
                type: 'input',
                name: 'netPortAnswer',
                message: 'Enter the network port of the existing node (default is 9732):',
                default: '9732'
            },
            {
                type: 'list',
                name: 'networkAnswer',
                message: 'Choose the network of the existing node:',
                choices: ['mainnet', 'ghostnet']
            }
        ]);

        rpcPort = rpcPortAnswer;
        netPort = netPortAnswer;
        network = networkAnswer;

        await setupBaker(rpcPort, network);
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

    if (setupType === 'nodeAndBaker') {
        console.log('Setting up baker...');
        await setupBaker(rpcPort, network);
    }

    console.log('Installation completed.');
    process.exit(0);
}

main();
