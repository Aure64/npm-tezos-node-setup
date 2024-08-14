const { execSync } = require('child_process');

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

module.exports = {
    parseNodeProcess,
    getNodeNetwork
};
