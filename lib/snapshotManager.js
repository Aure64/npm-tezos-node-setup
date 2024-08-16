const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');
const inquirer = require('inquirer');
const downloadFile = require('./downloadFile');

async function waitForIdentityFile(dataDir) {
    return new Promise((resolve, reject) => {
        const checkInterval = 2000; // 2 seconds
        const maxRetries = 15; // 60 seconds total
        let attempts = 0;

        const interval = setInterval(() => {
            if (fs.existsSync(path.join(dataDir, 'identity.json'))) {
                clearInterval(interval);
                resolve();
            } else {
                attempts++;
                if (attempts >= maxRetries) {
                    clearInterval(interval);
                    reject(new Error('Timeout waiting for identity.json file.'));
                }
            }
        }, checkInterval);
    });
}

function cleanNodeDataBeforeImport(dataDir) {
    console.log('Cleaning data before importing snapshot...');
    const filesToDelete = ['context', 'daily_logs', 'lock', 'store', 'config.json'];
    filesToDelete.forEach(file => {
        const filePath = path.join(dataDir, file);
        if (fs.existsSync(filePath)) {
            try {
                execSync(`sudo rm -rf ${filePath}`);
                console.log(`File removed: ${filePath}`);
            } catch (error) {
                console.error(`Failed to remove ${filePath}: ${error.message}`);
            }
        }
    });
}

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

async function importSnapshot(network, mode, dataDir, fastMode = false, snapshotPath, netPort) {
    console.log('Importing snapshot...');
    const noCheckFlag = fastMode ? '--no-check' : '';
    execSync(`octez-node snapshot import ${snapshotPath} --data-dir "${dataDir}" ${noCheckFlag}`);

    console.log(`Checking and stopping processes using the port ${netPort}...`);

    try {
        execSync('lsof -v');
    } catch (error) {
        console.error('lsof is not installed. Attempting to install it...');
        try {
            execSync('sudo apt-get update && sudo apt-get install -y lsof');
            console.log('lsof installed successfully.');
        } catch (installError) {
            console.error('Failed to install lsof. Please install it manually and rerun the script.');
            process.exit(1);
        }
    }

    try {
        const processes = execSync(`lsof -i :${netPort} -t`).toString().split('\n').filter(pid => pid);
        if (processes.length === 0) {
            console.log(`No processes found using port ${netPort}.`);
        } else {
            processes.forEach(pid => {
                try {
                    execSync(`sudo kill ${pid}`);
                    console.log(`Stopped process using port ${netPort}: ${pid}`);
                } catch (error) {
                    console.error(`Error stopping process ${pid}: ${error.message}`);
                }
            });
        }
    } catch (error) {
        console.error(`Error checking processes on port ${netPort}: ${error.message}`);
    }
}

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

module.exports = {
    waitForIdentityFile,
    cleanNodeDataBeforeImport,
    handleExistingDirectory,
    importSnapshot,
    getSnapshotSizes
};
