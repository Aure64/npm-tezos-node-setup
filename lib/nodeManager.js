const { execSync, spawn } = require('child_process');
const axios = require('axios');

function parseNodeProcess(processString) {
    const parts = processString.split(' ');
    const rpcPort = parts.includes('--rpc-addr') ? parts[parts.indexOf('--rpc-addr') + 1].split(':')[1] : '8732';
    const dataDir = parts.includes('--data-dir') ? parts[parts.indexOf('--data-dir') + 1] : null;
    return { rpcPort, dataDir };
}

function getNodeNetwork(dataDir) {
    try {
        const config = execSync(`octez-node config show --data-dir ${dataDir}`).toString();
        const configJson = JSON.parse(config);
        return configJson.network || 'unknown';
    } catch (error) {
        console.error(`Error retrieving network configuration from data-dir ${dataDir}: ${error.message}`);
        return 'unknown';
    }
}

async function waitForNodeToBootstrap(rpcPort) {
    console.log('Waiting for the node to fully bootstrapp...');

    return new Promise((resolve, reject) => {
        const tryBootstrapping = () => {
            const bootstrappingProcess = spawn('octez-client', ['--endpoint', `http://127.0.0.1:${rpcPort}`, 'bootstrapped']);

            bootstrappingProcess.stdout.on('data', (data) => {
                console.log(data.toString());
            });

            bootstrappingProcess.stderr.on('data', (data) => {
                console.error(data.toString());
            });

            bootstrappingProcess.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    if (code === 1) {
                        console.log('Node is not ready yet, retrying in 5 seconds...');
                        setTimeout(tryBootstrapping, 5000); // Retry after 5 seconds
                    } else {
                        reject(new Error(`Bootstrapping process exited with code ${code}`));
                    }
                }
            });
        };

        tryBootstrapping(); // Start the first attempt
    });
}
async function getCurrentProtocol(rpcPort) {
    try {
        const response = await axios.get(`http://127.0.0.1:${rpcPort}/chains/main/blocks/head`);
        return response.data.protocol;
    } catch (error) {
        console.error('Failed to retrieve current protocol:', error.message);
        throw error;
    }
}





module.exports = {
    parseNodeProcess,
    getNodeNetwork,
    waitForNodeToBootstrap,
    getCurrentProtocol
};
