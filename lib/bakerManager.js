const { execSync, spawn } = require('child_process');
const inquirer = require('inquirer');

function execWithSilencedWarnings(command) {
    return execSync(`${command} 2>&1 | grep -v "This is NOT the Tezos Mainnet"`).toString();
}

function updateClientConfig(rpcPort) {
    console.log(`Updating octez-client configuration to use port ${rpcPort}...`);
    execWithSilencedWarnings(`octez-client --endpoint http://127.0.0.1:${rpcPort}/ config update`);
}

function checkNodeBootstrapped() {
    console.log('Checking if node is bootstrapped...');
    while (true) {
        const output = execWithSilencedWarnings('octez-client bootstrapped');
        if (output.includes('Node is bootstrapped')) {
            console.log('Node is bootstrapped.');
            break;
        } else {
            console.log('Node is not yet bootstrapped. Waiting...');
            setTimeout(() => { }, 10000); // Wait 10 seconds before retrying
        }
    }
}

function listKnownAddressesWithBalances() {
    const output = execWithSilencedWarnings('octez-client list known addresses');
    const addresses = output.split('\n').filter(line => line.includes('tz1'));
    const addressesWithBalances = addresses.map(address => {
        const alias = address.split(':')[0].trim();
        let balance;
        try {
            balance = getBalance(alias);
        } catch (error) {
            balance = 0;
        }
        return `${address} (Balance: ${balance} ꜩ)`;
    });
    return addressesWithBalances;
}

function generateNewKey(alias) {
    console.log(`Generating new key with alias ${alias}...`);
    execWithSilencedWarnings(`octez-client gen keys ${alias}`);
}

function showAddress(alias, amountToSend) {
    const output = execWithSilencedWarnings(`octez-client show address ${alias}`);
    const address = output.match(/Hash: (tz1[^\s]+)/)[1];
    console.log(`Send ${amountToSend} ꜩ to ${address}`);
    return address;
}

function getBalance(alias) {
    const output = execWithSilencedWarnings(`octez-client get balance for ${alias}`);
    const balance = parseFloat(output.split(' ')[0]);
    if (isNaN(balance)) {
        throw new Error(`Could not retrieve balance for alias ${alias}`);
    }
    return balance;
}

async function useFaucet(alias, network, amount) {
    console.log(`Using faucet to send ${amount} ꜩ to ${alias} on ${network}...`);
    const address = showAddress(alias, amount);

    return new Promise((resolve, reject) => {
        const faucetProcess = spawn('npx', ['@oxheadalpha/get-tez', address, '--amount', amount, '--network', network], { stdio: 'inherit' });

        faucetProcess.on('close', (code) => {
            if (code === 0) {
                console.log('Faucet operation completed successfully.');
                resolve();
            } else {
                console.error(`Faucet operation failed with code ${code}.`);
                reject(new Error(`Faucet operation failed with code ${code}`));
            }
        });
    });
}

async function setupBaker(rpcPort, network) {
    updateClientConfig(rpcPort);
    checkNodeBootstrapped();

    const knownAddressesWithBalances = listKnownAddressesWithBalances();
    let alias;

    if (knownAddressesWithBalances.length > 0) {
        const { useExistingKey } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'useExistingKey',
                message: 'There are existing keys. Do you want to use an existing key?',
                default: true
            }
        ]);

        if (useExistingKey) {
            const { selectedAddress } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'selectedAddress',
                    message: 'Choose an existing address:',
                    choices: knownAddressesWithBalances
                }
            ]);
            alias = selectedAddress.split(':')[0].trim();
        } else {
            alias = await promptForNewKey();
        }
    } else {
        alias = await promptForNewKey();
    }

    let currentBalance;
    try {
        currentBalance = getBalance(alias);
    } catch (error) {
        console.error(`Failed to retrieve balance for ${alias}, assuming 0 ꜩ.`);
        currentBalance = 0;
    }
    const neededAmount = Math.max(6000 - currentBalance, 0);

    if (neededAmount === 0) {
        console.log(`The address ${alias} already has sufficient funds: ${currentBalance} ꜩ.`);
    } else {
        const { fundOption } = await inquirer.prompt([
            {
                type: 'list',
                name: 'fundOption',
                message: `The current balance is ${currentBalance} ꜩ. How would you like to fund the baker key?`,
                choices: ['Self-fund', 'Use faucet']
            }
        ]);

        if (fundOption === 'Self-fund') {
            const address = showAddress(alias, neededAmount);
            console.log(`Please send at least ${neededAmount} ꜩ to the address ${address}.`);
            await waitForBalance(alias, 6000);
        } else {
            const { amount } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'amount',
                    message: `Enter the amount of ꜩ to request from the faucet (minimum ${neededAmount} ꜩ to reach 6000 ꜩ):`,
                    default: neededAmount,
                    validate: value => value >= neededAmount || `You must request at least ${neededAmount} ꜩ.`
                }
            ]);
            await useFaucet(alias, network, amount);
            await waitForBalance(alias, 6000);
        }
    }

    console.log('Baker setup completed successfully.');
}

async function promptForNewKey() {
    const { alias } = await inquirer.prompt([
        {
            type: 'input',
            name: 'alias',
            message: 'Enter an alias for the new baker key (default is "baker_key"):',
            default: 'baker_key'
        }
    ]);
    generateNewKey(alias);
    return alias;
}

async function waitForBalance(alias, minBalance) {
    console.log(`Waiting for the balance of ${alias} to reach ${minBalance} ꜩ...`);
    while (true) {
        const balance = getBalance(alias);
        if (balance >= minBalance) {
            console.log(`Balance of ${alias} is sufficient: ${balance} ꜩ.`);
            break;
        } else {
            console.log(`Current balance: ${balance} ꜩ. Waiting for funds...`);
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds before retrying
        }
    }
}

module.exports = {
    updateClientConfig,
    checkNodeBootstrapped,
    listKnownAddressesWithBalances,
    generateNewKey,
    showAddress,
    getBalance,
    useFaucet,
    setupBaker
};
