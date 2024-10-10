const path = require('path');
const fs = require('fs');
const { exec, execSync } = require('child_process');
const { handleExistingDirectory, importSnapshot, waitForIdentityFile, cleanNodeData, cleanNodeDataBeforeImport } = require('./snapshotManager');
const { configureServiceUnit } = require('./serviceManager');
const { waitForNodeToBootstrap, getCurrentProtocol } = require('./nodeManager');
const downloadFile = require('./downloadFile');
const { askRpcAndNetPorts, askDirectoryLocation, askSnapshotImportMode, askConfirmDirectoryDeletion } = require('./choice');
const { checkPortInUse } = require('./detect'); // Ensure checkPortInUse is imported
const inquirer = require('inquirer');

// Function to initialize the Tezos node
async function initializeTezosNode(dataDir, network, mode) {
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
                await new Promise(resolve => setTimeout(resolve, 5000)); // Ensure process is fully stopped
                break;
            } catch (error) {
                console.error(error.message);
                cleanNodeData(dataDir); // Clean everything in case of failure after identity creation
            }
        } catch (error) {
            console.error(`Error initializing the node: ${error.message}`);
            process.exit(1);
        }
    }
}

// Function to handle L1 node setup workflow
async function setupL1Node(network, mode) {
    // Handle the directory setup
    let dataDir;
    let directoryConfirmed = false;

    while (!directoryConfirmed) {
        const { dirName, dirPath } = await askDirectoryLocation();
        dataDir = path.join(dirPath, dirName);

        if (fs.existsSync(dataDir)) {
            const confirmDeletion = await askConfirmDirectoryDeletion(dataDir);
            if (confirmDeletion) {
                const deletionSuccess = handleExistingDirectory(dataDir);
                if (!deletionSuccess) {
                    process.exit(1);
                }
                console.log(`Directory ${dataDir} has been deleted.`);
            } else {
                console.log('You chose not to delete the existing directory.');

                // Ask if they want to choose a new directory
                const newDirectoryResponse = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'chooseNewDir',
                        message: 'Would you like to choose a different directory?',
                        default: true
                    }
                ]);
                if (!newDirectoryResponse.chooseNewDir) {
                    console.log('Operation cancelled.');
                    process.exit(0);
                }
                // Continue the loop to re-prompt for a directory
                continue;
            }
        }

        // Recreate directory if it was deleted
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
            const username = process.env.USER || 'tezos';
            execSync(`sudo chown -R ${username}:${username} ${dataDir}`);
            console.log(`Changed ownership of ${dataDir} to ${username}:${username}`);
        }

        directoryConfirmed = true; // Confirm the directory is valid
    }

    // Select RPC and network ports
    let rpcPort, netPort;
    let portsInUse;
    do {
        ({ rpcPort, netPort } = await askRpcAndNetPorts());
        console.log(`Checking if selected ports are in use: RPC Port: ${rpcPort}, Network Port: ${netPort}...`);
        portsInUse = await Promise.all([
            checkPortInUse(rpcPort),
            checkPortInUse(netPort)
        ]);

        if (portsInUse[0] || portsInUse[1]) {
            console.log(`Port(s) ${portsInUse[0] ? rpcPort : ''} ${portsInUse[1] ? netPort : ''} is/are already in use. Please choose different ports.`);
        }
    } while (portsInUse[0] || portsInUse[1]); // Loop until valid ports are entered

    // Initialize the node and create identity
    await initializeTezosNode(dataDir, network, mode);

    // Ask if the user wants to import the snapshot in fast or safe mode
    const fastMode = await askSnapshotImportMode();

    // Clean the directory before importing the snapshot
    cleanNodeDataBeforeImport(dataDir);

    // Import snapshot
    const snapshotPath = '/tmp/snapshot';
    await downloadFile(`https://snapshots.eu.tzinit.org/${network}/${mode}`, snapshotPath);
    await importSnapshot(network, mode, dataDir, fastMode, snapshotPath, netPort);

    // Configure systemd service
    const serviceName = path.basename(dataDir);
    await configureServiceUnit(dataDir, rpcPort, netPort, serviceName);

    // Wait for the node to bootstrap
    await waitForNodeToBootstrap(rpcPort);

    // Retrieve and display the current protocol
    const protocolHash = await getCurrentProtocol(rpcPort);
    console.log(`Current protocol: ${protocolHash}`);

    return { rpcPort, netPort, dataDir, protocolHash };
}

module.exports = {
    setupL1Node
};
