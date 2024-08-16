const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');
const sudoPrompt = require('sudo-prompt');

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

function cleanNodeData(dataDir) {
    console.log('Cleaning data node...');
    const filesToDelete = ['context', 'daily_logs', 'lock', 'store', 'version.json', 'config.json'];
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

function cleanNodeDataBeforeImport(dataDir) {
    console.log('Cleaning data before importing snapshot...');
    const filesToDelete = ['context', 'daily_logs', 'lock', 'store'];
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

async function removeDirectoryWithSudo(dirPath) {
    return new Promise((resolve, reject) => {
        const options = {
            name: 'Tezos Node Setup',
        };
        const command = `rm -rf ${dirPath}`;
        sudoPrompt.exec(command, options, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                console.log(`Directory removed: ${dirPath}`);
                resolve();
            }
        });
    });
}

async function importSnapshot(network, mode, dataDir, fastMode = false, snapshotPath) {
    console.log('Importing snapshot...');
    const noCheckFlag = fastMode ? '--no-check' : '';
    execSync(`octez-node snapshot import ${snapshotPath} --data-dir "${dataDir}" ${noCheckFlag}`);

    // Stop any process using the network port after snapshot import
    console.log('Checking and stopping processes using the default port 9732...');
    try {
        const processes = execSync('lsof -i :9732 -t').toString().split('\n').filter(pid => pid);
        processes.forEach(pid => {
            try {
                execSync(`sudo kill ${pid}`);
                console.log(`Stopped process using port 9732: ${pid}`);
            } catch (error) {
                console.error(`Error stopping process ${pid}: ${error.message}`);
            }
        });
    } catch (error) {
        console.error('No processes found using port 9732.');
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
    cleanNodeData,
    cleanNodeDataBeforeImport,
    importSnapshot,
    getSnapshotSizes,
    removeDirectoryWithSudo
};
