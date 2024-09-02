const axios = require('axios');
const fs = require('fs');
const cliProgress = require('cli-progress');

// Function to download a file from a given URL to a specified destination
async function downloadFile(url, destination, retries = 3, timeout = 10000) {
    console.log(`Downloading from ${url} to ${destination}...`);

    // Helper function for retry logic
    const downloadWithRetry = async (attempt) => {
        const writer = fs.createWriteStream(destination);  // Create a write stream to the destination file

        try {
            // Make a GET request to download the file as a stream with a timeout
            const { data, headers } = await axios({
                url,
                method: 'GET',
                responseType: 'stream',
                timeout
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
                    resolve();
                });

                writer.on('error', (err) => {
                    progressBar.stop();  // Stop the progress bar on error
                    console.error(`Error while downloading:`, err.message);
                    reject(err);
                });
            });
        } catch (error) {
            writer.close();  // Close the stream in case of an error
            if (fs.existsSync(destination)) {
                fs.unlinkSync(destination);  // Delete incomplete file
            }

            if (attempt < retries) {
                console.log(`Retrying download... Attempt ${attempt + 1} of ${retries}`);
                await new Promise(resolve => setTimeout(resolve, 2000));  // Wait before retrying
                return downloadWithRetry(attempt + 1);  // Retry download
            } else {
                console.error(`Failed to download file after ${retries} attempts: ${error.message}`);
                throw error;
            }
        }
    };

    // Start the download process with retry logic
    return downloadWithRetry(0);
}

module.exports = downloadFile;
