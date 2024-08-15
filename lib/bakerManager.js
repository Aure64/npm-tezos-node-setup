const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const { configureBakerServiceWithoutEncryption, configureBakerServiceWithEncryption } = require('./serviceManager');
const { execSync, spawnSync } = require('child_process');

function execWithSilencedWarnings(command) {
    return execSync(`${command} 2>&1 | grep -v "This is NOT the Tezos Mainnet"`).toString();
}

function updateClientConfig(rpcPort) {
    console.log(`Updating octez-client configuration to use port ${rpcPort}...`);
    const endpoint = `http://127.0.0.1:${rpcPort}`;
    execWithSilencedWarnings(`octez-client --endpoint ${endpoint} config update`);
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

function formatBalance(balance) {
    return balance.toFixed(0); // Formate la balance en un entier (sans décimales)
}

function listKnownAddressesWithBalances() {
    const output = execWithSilencedWarnings('octez-client list known addresses');
    const addresses = output.split('\n').filter(line => line.includes('tz'));
    const addressesWithBalances = addresses.map(address => {
        const alias = address.split(':')[0].trim();
        let balance = 0;
        try {
            balance = getBalance(alias);
        } catch (error) {
            console.error(`Failed to retrieve balance for ${alias}. Assuming 0 ꜩ.`);
            console.error(`Error message: ${error.message}`);
        }
        return `${address} (Balance: ${formatBalance(balance)} ꜩ)`;
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
    if (amountToSend !== undefined) {
        console.log(`Send ${amountToSend} ꜩ to ${address}`);
    } else {
        console.log(`Please send at least 6000 ꜩ to the address ${address}.`);
    }
    return address;
}

function getBalance(alias) {
    try {
        const output = execWithSilencedWarnings(`octez-client get balance for ${alias}`);
        const balanceLine = output.split('\n').filter(line => line.includes('ꜩ'))[0];
        const balance = parseFloat(balanceLine.split(' ')[0]);
        if (isNaN(balance)) {
            throw new Error(`Invalid balance format for alias ${alias}: ${output}`);
        }
        return balance;
    } catch (error) {
        throw new Error(`Failed to retrieve balance for ${alias}: ${error.message}`);
    }
}

async function useFaucet(alias, network, amount) {
    console.log(`Using faucet to send ${amount} ꜩ to ${alias} on ${network}...`);
    const address = showAddress(alias, amount);

    return new Promise((resolve, reject) => {
        const faucetProcess = spawnSync('npx', ['@oxheadalpha/get-tez', address, '--amount', amount, '--network', network], { stdio: 'inherit' });

        if (faucetProcess.status === 0) {
            console.log('Faucet operation completed successfully.');
            resolve();
        } else {
            console.error(`Faucet operation failed with code ${faucetProcess.status}.`);
            reject(new Error(`Faucet operation failed with code ${faucetProcess.status}`));
        }
    });
}

async function setupBaker(dataDir, rpcPort, network) {
    updateClientConfig(rpcPort);
    checkNodeBootstrapped();

    const knownAddresses = listKnownAddressesWithBalances();
    let alias;

    if (knownAddresses.length > 0) {
        const { keyOption } = await inquirer.prompt([
            {
                type: 'list',
                name: 'keyOption',
                message: 'There are existing keys. What would you like to do?',
                choices: [
                    { name: 'Use an existing key', value: 'useExisting' },
                    { name: 'Create a new key', value: 'createNew' },
                    { name: 'Import a key from a Ledger', value: 'importLedger' },
                    { name: 'Import a secret key', value: 'importSecret' }
                ]
            }
        ]);

        if (keyOption === 'useExisting') {
            const { selectedAddress } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'selectedAddress',
                    message: 'Choose an existing address:',
                    choices: knownAddresses
                }
            ]);
            alias = selectedAddress.split(':')[0].trim();
        } else if (keyOption === 'createNew') {
            alias = await promptForNewKey();
        } else if (keyOption === 'importLedger') {
            alias = await importKeyFromLedger();
        } else if (keyOption === 'importSecret') {
            alias = await importSecretKey();
        }
    } else {
        alias = await promptForNewKey();
    }

    const currentBalance = getBalance(alias);

    if (currentBalance >= 6000) {
        const { continueOption } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'continueOption',
                message: `The balance of ${alias} is sufficient (${currentBalance} ꜩ). Do you want to continue?`,
                default: true
            }
        ]);

        if (!continueOption) {
            console.log('Baker setup aborted.');
            return;
        }
    } else {
        const { fundOption } = await inquirer.prompt([
            {
                type: 'list',
                name: 'fundOption',
                message: 'How would you like to fund the baker key?',
                choices: ['Self-fund', 'Use faucet']
            }
        ]);

        if (fundOption === 'Self-fund') {
            showAddress(alias);
            await waitForBalance(alias, 6000);
        } else {
            const amountNeeded = 6000 - currentBalance;
            const { amount } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'amount',
                    message: `Enter the amount of ꜩ to request from the faucet (minimum ${amountNeeded} ꜩ to reach 6000 ꜩ):`,
                    validate: value => value >= amountNeeded || `You must request at least ${amountNeeded} ꜩ.`
                }
            ]);
            await useFaucet(alias, network, amount);
            await waitForBalance(alias, 6000);
        }
    }

    await registerAsDelegate(alias, network);

    const { setupService } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'setupService',
            message: 'Do you want to setup and start the baker service?',
            default: true
        }
    ]);

    if (setupService) {
        if (isKeyEncrypted(alias)) {
            const { password } = await inquirer.prompt([
                {
                    type: 'password',
                    name: 'password',
                    message: 'Enter the password for the encrypted key:',
                }
            ]);

            const passwordFilePath = path.join('/tmp', `${alias}_password`);
            fs.writeFileSync(passwordFilePath, password);

            await configureBakerServiceWithEncryption(dataDir, rpcPort, alias, alias, passwordFilePath);

            fs.unlinkSync(passwordFilePath); // Supprimer le fichier de mot de passe après démarrage du service
        } else {
            await configureBakerServiceWithoutEncryption(dataDir, rpcPort, alias, alias);
        }
    }

    console.log('Baker setup completed successfully.');
}

async function registerAsDelegate(alias, network) {
    const isEncrypted = alias.includes('encrypted sk');
    if (isEncrypted) {
        console.log(`Registering ${alias} as a delegate on the ${network} network...`);
        const registerProcess = spawnSync('octez-client', ['register', 'key', alias, 'as', 'delegate'], { stdio: 'inherit' });
        if (registerProcess.status !== 0) {
            throw new Error(`Failed to register ${alias} as a delegate.`);
        }
    } else {
        execSync(`octez-client register key ${alias} as delegate`, { stdio: 'inherit' });
        console.log(`Key ${alias} has been registered as a delegate.`);
    }
}

async function importKeyFromLedger() {
    console.log('Listing connected Ledgers...');
    const output = execSync('octez-client list connected ledgers').toString();
    console.log(output);

    const { ledgerPath, alias } = await inquirer.prompt([
        {
            type: 'input',
            name: 'ledgerPath',
            message: 'Enter the ledger path (e.g., ledger://0):'
        },
        {
            type: 'input',
            name: 'alias',
            message: 'Enter an alias for the imported key:'
        }
    ]);

    console.log(`Importing key from Ledger...`);
    execSync(`octez-client import secret key ${alias} ${ledgerPath}`);
    return alias;
}

async function importSecretKey() {
    const { alias, secretKey } = await inquirer.prompt([
        {
            type: 'input',
            name: 'alias',
            message: 'Enter an alias for the imported key:'
        },
        {
            type: 'password',
            name: 'secretKey',
            message: 'Enter the secret key:'
        }
    ]);

    console.log(`Importing secret key...`);
    execSync(`octez-client import secret key ${alias} ${secretKey}`);
    return alias;
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
            console.log(`Balance of ${alias} is sufficient: ${formatBalance(balance)} ꜩ.`);
            break;
        } else {
            console.log(`Current balance: ${formatBalance(balance)} ꜩ. Waiting for funds...`);
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
