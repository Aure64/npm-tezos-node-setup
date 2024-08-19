const axios = require('axios');
const fs = require('fs');
const cliProgress = require('cli-progress');

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
    const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

    progressBar.start(parseInt(totalLength), 0);  // Start the progress bar with the total file length

    // Increment the progress bar as data chunks are received
    data.on('data', (chunk) => progressBar.increment(chunk.length));
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
