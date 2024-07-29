const axios = require('axios');
const fs = require('fs');
const cliProgress = require('cli-progress');

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

module.exports = downloadFile;
