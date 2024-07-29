const axios = require('axios');
const fs = require('fs');
const cliProgress = require('cli-progress');
const { execSync } = require('child_process');
const path = require('path');

const SNAPSHOT_BASE_URL = 'https://snapshots.eu.tzinit.org';

async function getSnapshotSizes(network) {
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

async function downloadFile(url, destination) {
    console.log(`Téléchargement du fichier depuis ${url} vers ${destination}...`);
    const writer = fs.createWriteStream(destination);
    const { data, headers } = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });

    const totalLength = headers['content-length'];
    const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

    progressBar.start(parseInt(totalLength), 0);

    data.on('data', (chunk) => progressBar.increment(chunk.length));
    data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', () => {
            progressBar.stop();
            console.log(`Téléchargement terminé : ${destination}`);
            resolve();
        });

        writer.on('error', (err) => {
            progressBar.stop();
            console.error(`Erreur lors du téléchargement du fichier :`, err.message);
            reject(err);
        });
    });
}

async function importSnapshot(network, mode, dataDir, fastMode) {
    const snapshotUrl = `${SNAPSHOT_BASE_URL}/${network}/${mode}`;
    console.log(`Téléchargement du snapshot depuis ${snapshotUrl}...`);
    await downloadFile(snapshotUrl, '/tmp/snapshot');

    console.log('Importation du snapshot...');
    const importCommand = `octez-node snapshot import /tmp/snapshot --data-dir ${dataDir} ${fastMode ? '--no-check' : ''}`;
    execSync(importCommand, { stdio: 'inherit' });
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

module.exports = {
    getSnapshotSizes,
    downloadFile,
    importSnapshot,
    cleanNodeData,
    waitForIdentityFile
};
