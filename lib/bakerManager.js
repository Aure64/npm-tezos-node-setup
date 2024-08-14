const { execSync } = require('child_process');

function updateClientConfig(rpcPort) {
    console.log(`Updating octez-client configuration to use port ${rpcPort}...`);
    execSync(`octez-client --endpoint http://127.0.0.1:${rpcPort}/ config update`);
}

function checkNodeBootstrapped() {
    console.log('Checking if node is bootstrapped...');
    while (true) {
        const output = execSync('octez-client bootstrapped').toString();
        if (output.includes('Node is bootstrapped')) {
            console.log('Node is bootstrapped.');
            break;
        } else {
            console.log('Node is not yet bootstrapped. Waiting...');
            setTimeout(() => { }, 10000); // Wait 10 seconds before retrying
        }
    }
}

function listKnownAddresses() {
    const output = execSync('octez-client list known addresses').toString();
    const addresses = output.split('\n').filter(line => line.includes('tz1'));
    return addresses;
}

function generateNewKey(alias) {
    console.log(`Generating new key with alias ${alias}...`);
    execSync(`octez-client gen keys ${alias}`);
}

function showAddress(alias) {
    const output = execSync(`octez-client show address ${alias}`).toString();
    const address = output.match(/Hash: (tz1[^\s]+)/)[1];
    console.log(`Send 6000 ꜩ to ${address}`);
    return address;
}

function getBalance(alias) {
    const output = execSync(`octez-client get balance for ${alias}`).toString();
    const balance = parseFloat(output.split(' ')[0]);
    return balance;
}

function useFaucet(alias, network, amount) {
    console.log(`Using faucet to send ${amount} ꜩ to ${alias} on ${network}...`);
    const address = showAddress(alias);
    execSync(`npx @oxheadalpha/get-tez ${address} --amount ${amount} --network ${network}`);
}

module.exports = {
    updateClientConfig,
    checkNodeBootstrapped,
    listKnownAddresses,
    generateNewKey,
    showAddress,
    getBalance,
    useFaucet
};
