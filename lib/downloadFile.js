const axios = require('axios');
const fs = require('fs');
const cliProgress = require('cli-progress');

// Function to format size into readable units
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Function to download a file from a given URL to a specified destination
async function downloadFile(url, destination) {
    console.log(`Downloading from ${url} to ${destination}...`);
    const writer = fs.createWriteStream(destination);  // Create a write stream to the destination file

    // Make a GET request to download the file as a stream
    const { data, headers } = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });

    const totalLength = headers['content-length'];  // Get the total length of the file from the headers

    // Display file size in a readable format (MB)
    console.log(`File size: ${formatBytes(totalLength, 2)}`);

    const progressBar = new cliProgress.SingleBar({
        format: 'Progress | {bar} | {percentage}% | {value}/{total} MB',
        hideCursor: true
    }, cliProgress.Presets.shades_classic);

    progressBar.start(Math.ceil(totalLength / (1024 * 1024)), 0);  // Start the progress bar with the size in MB

    // Increment the progress bar as data chunks are received
    let downloadedLength = 0;
    data.on('data', (chunk) => {
        downloadedLength += chunk.length;
        progressBar.update(Math.ceil(downloadedLength / (1024 * 1024)));  // Update in MB
    });

    data.pipe(writer);  // Pipe the data to the file write stream

    // Return a promise that resolves when the download is finished
    return new Promise((resolve, reject) => {
        writer.on('finish', () => {
            progressBar.stop();  // Stop the progress bar
            console.log(`Download finished: ${destination}`);
            resolve();  // Resolve the promise when the download is complete
        });

        writer.on('error', (err) => {
            progressBar.stop();  // Stop the progress bar on error
            console.error(`Error while downloading:`, err.message);
            reject(err);  // Reject the promise if an error occurs
        });
    });
}

module.exports = downloadFile;
