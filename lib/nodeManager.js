const { execSync } = require('child_process');
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

function waitForNodeToBootstrap(rpcPort) {
    return new Promise((resolve, reject) => {
        const bootstrappingProcess = execSync(`octez-client --endpoint http://127.0.0.1:${rpcPort} bootstrapped`);

        bootstrappingProcess.stdout.on('data', (data) => {
            console.log(data.toString());
            if (data.includes('Node is bootstrapped.')) {
                resolve();
            }
        });

        bootstrappingProcess.stderr.on('data', (data) => {
            console.error(data.toString());
        });

        bootstrappingProcess.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Bootstrapping process exited with code ${code}`));
            } else {
                resolve();
            }
        });
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
