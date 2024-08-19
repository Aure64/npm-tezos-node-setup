const { execSync } = require('child_process');
const axios = require('axios');
const { cleanNodeDataBeforeImport } = require('./snapshotManager');

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
    console.log('Waiting for the node to fully bootstrap...');
    while (true) {
        try {
            const response = await axios.get(`http://127.0.0.1:${rpcPort}/chains/main/blocks/head/header`);
            if (response.data.chain_status === 'synced') {
                console.log('Node is fully bootstrapped.');
                break;
            } else {
                console.log('Node is still bootstrapping...');
            }
        } catch (error) {
            console.error(error.response ? error.response.data : 'Failed to retrieve node status, retrying...');
        }
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait for 10 seconds before checking again
    }
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
