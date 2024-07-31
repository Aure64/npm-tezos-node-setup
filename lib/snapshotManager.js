const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const downloadFile = require('./downloadFile');

async function waitForIdentityFile(dataDir) {
    return new Promise((resolve, reject) => {
        const checkInterval = 2000; // 2 seconds
        const maxRetries = 30; // 60 seconds total
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
    const itemsToDelete = ['context', 'daily_logs', 'lock', 'store', 'config.json', 'version.json'];
    itemsToDelete.forEach(item => {
        const itemPath = path.join(dataDir, item);
        if (fs.existsSync(itemPath)) {
            fs.rmSync(itemPath, { recursive: true, force: true });
            console.log(`Dossier supprimé : ${itemPath}`);
        }
    });
}

async function importSnapshot(network, mode, dataDir, fastMode, snapshotPath) {
    console.log('Importation du snapshot...');
    const noCheckFlag = fastMode ? '--no-check' : '';
    try {
        execSync(`octez-node snapshot import ${snapshotPath} --data-dir ${dataDir} ${noCheckFlag}`);
        console.log(`Importation réussie du snapshot à partir du fichier ${snapshotPath}`);
    } catch (error) {
        console.error(`Erreur lors de l'importation du snapshot : ${error}`);
        throw error;
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
