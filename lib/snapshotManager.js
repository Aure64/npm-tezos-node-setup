const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');
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

function cleanNodeData(dataDir) {
    console.log(`Cleaning data node: ${dataDir}...`);
    try {
        execSync(`sudo rm -rf ${dataDir}`);
        console.log(`Directory removed: ${dataDir}`);
    } catch (error) {
        console.error(`Failed to remove directory ${dataDir}: ${error.message}`);
        throw error;  // Ajoutez ceci si vous voulez arrêter le script en cas d'échec
    }
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

async function importSnapshot(network, mode, dataDir, fastMode = false, snapshotPath) {
    console.log('Importing snapshot...');
    const noCheckFlag = fastMode ? '--no-check' : '';
    execSync(`octez-node snapshot import ${snapshotPath} --data-dir "${dataDir}" ${noCheckFlag}`);
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
    getSnapshotSizes
};
