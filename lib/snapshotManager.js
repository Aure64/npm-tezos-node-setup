// Import required modules
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync, exec } = require('child_process');
const inquirer = require('inquirer');

// Function to wait for the creation of the identity file in the Tezos node data directory
async function waitForIdentityFile(dataDir) {
    return new Promise((resolve, reject) => {
        const checkInterval = 2000; // 2 seconds
        const maxRetries = 15; // Maximum of 15 attempts, or 60 seconds
        let attempts = 0;

        const interval = setInterval(() => {
            if (fs.existsSync(path.join(dataDir, 'identity.json'))) {
                // If identity file exists, resolve the promise and clear the interval
                clearInterval(interval);
                resolve();
            } else {
                attempts++;
                if (attempts >= maxRetries) {
                    // If maximum attempts reached without finding the file, reject the promise
                    clearInterval(interval);
                    reject(new Error('Timeout waiting for identity.json file.'));
                }
            }
        }, checkInterval);
    });
}

// Function to clean the node data directory by removing specific files
function cleanNodeData(dataDir) {
    console.log('Cleaning node data...');
    const filesToDelete = ['context', 'daily_logs', 'lock', 'store', 'version.json', 'config.json'];
    filesToDelete.forEach(file => {
        const filePath = path.join(dataDir, file);
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, { recursive: true, force: true });
            console.log(`File removed: ${filePath}`);
        }
    });
}

// Function to clean node data before importing a snapshot, removing only essential files
function cleanNodeDataBeforeImport(dataDir) {
    console.log('Cleaning files before snapshot import...');
    const filesToDelete = ['context', 'daily_logs', 'lock', 'store'];
    filesToDelete.forEach(file => {
        const filePath = path.join(dataDir, file);
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, { recursive: true, force: true });
            console.log(`File removed: ${filePath}`);
        }
    });
}

// Function to handle an existing directory, offering to delete or rename it
async function handleExistingDirectory(dataDir) {
    console.log(`The directory ${dataDir} already exists.`);

    try {
        execSync(`sudo rm -rf ${dataDir}`);
        console.log(`Directory ${dataDir} removed successfully.`);
        return dataDir;
    } catch (error) {
        console.error(`Failed to remove directory ${dataDir}: ${error.message}`);

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Unable to remove the directory. Would you like to:',
                choices: [
                    'Remove the directory manually and rerun the script',
                    'Specify a new directory'
                ]
            }
        ]);

        if (action === 'Remove the directory manually and rerun the script') {
            console.log('Please remove the directory manually and rerun the script.');
            process.exit(1);
        } else {
            const { newDir } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'newDir',
                    message: 'Enter the new directory path:',
                    default: path.join(path.dirname(dataDir), 'tezos-node-new')
                }
            ]);
            return newDir;
        }
    }
}

// Function to import a snapshot into the Tezos node, with optional fast mode
async function importSnapshot(network, mode, dataDir, fastMode = false, snapshotPath, netPort) {
    if (!netPort) {
        throw new Error('Network port (netPort) is undefined.');
    }

    console.log('Importing snapshot...');
    const noCheckFlag = fastMode ? '--no-check' : '';
    execSync(`octez-node snapshot import ${snapshotPath} --data-dir "${dataDir}" ${noCheckFlag}`);

    console.log(`Checking and stopping processes using the port ${netPort}...`);

    try {
        const processes = execSync(`pgrep -f 'octez-node'`).toString().trim().split('\n');
        processes.forEach(pid => {
            try {
                execSync(`sudo kill ${pid}`);
                console.log(`Stopped process using port ${netPort}: ${pid}`);
            } catch (error) {
                console.error(`Error stopping process ${pid}: ${error.message}`);
            }
        });
    } catch (error) {
        console.log(`All processes using port ${netPort} have been stopped.`);
    }
}

// Function to retrieve the sizes of available snapshots (full and rolling) for a given network
async function getSnapshotSizes(network) {
    const SNAPSHOT_BASE_URL = 'https://snapshots.eu.tzinit.org';
    const modes = ['full', 'rolling'];
    const sizes = {};

    for (const mode of modes) {
        const snapshotUrl = `${SNAPSHOT_BASE_URL}/${network}/${mode}`;
        try {
            const response = await axios.head(snapshotUrl);
            const sizeInBytes = response.headers['content-length'];
            const sizeInGB = (sizeInBytes / (1024 ** 3)).toFixed(2);
            sizes[mode] = sizeInGB;
        } catch (error) {
            console.error(`Error retrieving snapshot size for mode ${mode}:`, error.message);
            sizes[mode] = 'unknown';
        }
    }

    return sizes;
}

// Exporting functions for use in other modules
module.exports = {
    waitForIdentityFile,
    cleanNodeData,
    cleanNodeDataBeforeImport,
    handleExistingDirectory,
    importSnapshot,
    getSnapshotSizes
};
