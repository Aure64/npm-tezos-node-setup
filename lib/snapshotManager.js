const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const axios = require('axios');
const downloadFile = require('./downloadFile');

function waitForIdentityFile(dataDir) {
    return new Promise((resolve, reject) => {
        const checkInterval = 2000; // 2 seconds
        const maxRetries = 15; // 30 seconds total
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
    console.log('Nettoyage des données du nœud...');
    const dirsToDelete = ['context', 'daily_logs', 'lock', 'store'];
    dirsToDelete.forEach(dir => {
        const dirPath = path.join(dataDir, dir);
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true });
        }
    });
}

async function importSnapshot(network, mode, dataDir, fastMode = false) {
    const snapshotUrl = `https://snapshots.eu.tzinit.org/${network}/${mode}`;
    console.log(`Téléchargement du snapshot depuis ${snapshotUrl}...`);
    await downloadFile(snapshotUrl, '/tmp/snapshot');
    console.log('Importation du snapshot...');
    const noCheckOption = fastMode ? '--no-check' : '';
    execSync(`octez-node snapshot import /tmp/snapshot --data-dir ${dataDir} ${noCheckOption}`);
}

async function getSnapshotSizes(network) {
    const modes = ['full', 'rolling'];
    const sizes = {};

    for (const mode of modes) {
        const snapshotUrl = `https://snapshots.eu.tzinit.org/${network}/${mode}`;
        try {
            const response = await axios.head(snapshotUrl);
            const sizeInBytes = response.headers['content-length'];
            const sizeInGB = (sizeInBytes / (1024 ** 3)).toFixed(2);
            sizes[mode] = sizeInGB;
        } catch (error) {
            console.error(`Erreur lors de la récupération de la taille du snapshot pour le mode ${mode}:`, error.message);
            sizes[mode] = 'unknown';
        }
    }

    return sizes;
}

module.exports = {
    waitForIdentityFile,
    cleanNodeData,
    importSnapshot,
    getSnapshotSizes
};
