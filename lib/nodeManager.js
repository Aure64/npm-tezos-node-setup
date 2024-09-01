const { execSync, spawn } = require('child_process');
const axios = require('axios');

// Function to parse the node process string and extract the RPC port and data directory
function parseNodeProcess(processString) {
    const parts = processString.split(' ');  // Split the process string by spaces to get the individual arguments
    const rpcPort = parts.includes('--rpc-addr') ? parts[parts.indexOf('--rpc-addr') + 1].split(':')[1] : '8732';  // Extract the RPC port if specified, default to 8732
    const dataDir = parts.includes('--data-dir') ? parts[parts.indexOf('--data-dir') + 1] : null;  // Extract the data directory if specified
    return { rpcPort, dataDir };  // Return an object containing the RPC port and data directory
}

// Function to retrieve the network configuration from the node's data directory
function getNodeNetwork(dataDir) {
    try {
        const config = execSync(`octez-node config show --data-dir ${dataDir}`).toString();  // Execute the command to show the node configuration
        const configJson = JSON.parse(config);  // Parse the configuration output as JSON
        return configJson.network || 'unknown';  // Return the network if available, otherwise return 'unknown'
    } catch (error) {
        console.error(`Error retrieving network configuration from data-dir ${dataDir}: ${error.message}`);  // Log any errors encountered
        return 'unknown';  // Return 'unknown' if an error occurs
    }
}

// Function to wait for the Tezos node to fully bootstrap
async function waitForNodeToBootstrap(rpcPort) {
    console.log('Waiting for the node to bootstrap...');
    await new Promise(resolve => setTimeout(resolve, 10000));  // Sleep for 10 seconds

    return new Promise((resolve, reject) => {
        const tryBootstrapping = () => {
            const bootstrappingProcess = spawn('octez-client', ['--endpoint', `http://127.0.0.1:${rpcPort}`, 'bootstrapped']);  // Spawn the bootstrapping process

            bootstrappingProcess.stdout.on('data', (data) => {
                console.log(data.toString());  // Log standard output from the bootstrapping process
            });

            bootstrappingProcess.stderr.on('data', (data) => {
                console.error(data.toString());  // Log any errors from the bootstrapping process
            });

            bootstrappingProcess.on('close', (code) => {
                if (code === 0) {
                    resolve();  // Resolve the promise if the bootstrapping process exits successfully
                } else {
                    if (code === 1) {
                        console.log('Node is not ready yet, retrying in 5 seconds...');
                        setTimeout(tryBootstrapping, 5000);  // Retry the bootstrapping process after 5 seconds if the node is not ready
                    } else {
                        reject(new Error(`Bootstrapping process exited with code ${code}`));  // Reject the promise if the bootstrapping process exits with an error
                    }
                }
            });
        };

        tryBootstrapping();  // Start the first attempt to bootstrap the node
    });
}

// Function to get the current Tezos protocol
async function getCurrentProtocol(rpcPort, retries = 5, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios.get(`http://127.0.0.1:${rpcPort}/chains/main/blocks/head`);
            return response.data.protocol;
        } catch (error) {
            console.error(`Failed to retrieve current protocol: ${error.message}`);
            if (i < retries - 1) {
                console.log(`Retrying in ${delay / 1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
}


// Export the functions for use in other modules
module.exports = {
    parseNodeProcess,
    getNodeNetwork,
    waitForNodeToBootstrap,
    getCurrentProtocol
};
