const fs = require('fs');
const { execSync } = require('child_process');
const inquirer = require('inquirer');
const { configureBakerService } = require('./serviceManager');

let selectedBakerInfo = {
    alias: null,
    address: null
};

// Function to set the selected baker address and alias
function setAddress(alias, address) {
    selectedBakerInfo.alias = alias;
    selectedBakerInfo.address = address;
}

// Function to get the selected baker address and alias
function getAddress() {
    return selectedBakerInfo;
}

// Function to execute a command with silenced warnings
function execWithSilencedWarnings(command) {
    return execSync(`${command} 2>&1 | grep -v "This is NOT the Tezos Mainnet"`).toString();
}

// Function to update the octez-client configuration to use a specified RPC port
function updateClientConfig(rpcPort) {
    const endpoint = `http://127.0.0.1:${rpcPort}`;
    console.log(`Updating octez-client configuration to use endpoint ${endpoint}...`);
    execWithSilencedWarnings(`octez-client --endpoint ${endpoint} config update`);
}

// Function to continuously check if the Tezos node is fully bootstrapped
function checkNodeBootstrapped() {
    console.log('Checking if node is bootstrapped...');
    while (true) {
        const output = execWithSilencedWarnings('octez-client bootstrapped');
        if (output.includes('Node is bootstrapped')) {
            console.log('Node is bootstrapped.');
            break;
        } else {
            console.log('Node is not yet bootstrapped. Waiting...');
            setTimeout(() => { }, 10000); // Wait for 10 seconds before checking again
        }
    }
}

// Function to format the balance as an integer
function formatBalance(balance) {
    return balance.toFixed(0);
}

// Function to list all known Tezos addresses along with their balances
function listKnownAddressesWithBalances() {
    const output = execWithSilencedWarnings('octez-client list known addresses');
    const addresses = output.split('\n').filter(line => line.includes('tz'));
    return addresses.map(address => {
        const alias = address.split(':')[0].trim();
        let balance = 0;
        try {
            balance = getBalance(alias);
        } catch (error) {
            console.error(`Failed to retrieve balance for ${alias}. Assuming 0 ꜩ.`);
        }
        return `${address} (Balance: ${formatBalance(balance)} ꜩ)`;
    });
}

// Function to generate a new Tezos key with a specified alias
function generateNewKey(alias) {
    console.log(`Generating new key with alias ${alias}...`);
    execWithSilencedWarnings(`octez-client gen keys ${alias}`);
}

// Function to show the address associated with a specified alias
function showAddress(alias) {
    const output = execWithSilencedWarnings(`octez-client show address ${alias}`);
    return output.match(/Hash: (tz[^\s]+)/)[1];
}

// Function to get the balance of a specified alias
function getBalance(alias) {
    const output = execWithSilencedWarnings(`octez-client get balance for ${alias}`);
    const balanceLine = output.split('\n').filter(line => line.includes('ꜩ'))[0];
    return parseFloat(balanceLine.split(' ')[0]);
}



// Function to use a faucet to send a specified amount of ꜩ to an alias on a specified network
async function useFaucet(alias, network, amount) {
    const address = showAddress(alias);
    console.log(`Using faucet to send ${amount} ꜩ to ${address} on ${network}...`);

    try {
        // Execute the faucet command and display the output in real-time
        execSync(`npx @oxheadalpha/get-tez ${address} --amount ${amount} --network ${network}`, { stdio: 'inherit' });
        console.log('Faucet operation completed successfully.');
    } catch (error) {
        console.error(`Faucet operation failed: ${error.message}`);
        throw error;
    }
}




// Function to check if a Tezos key is encrypted
function isKeyEncrypted(alias) {
    const output = execWithSilencedWarnings('octez-client list known addresses');
    return output.includes(`${alias} (encrypted sk known)`);
}

// Function to set up the Tezos baker, including key management and service configuration
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
            setAddress(alias, showAddress(alias));
        } else if (keyOption === 'createNew') {
            alias = await promptForNewKey();
            setAddress(alias, showAddress(alias));
        } else if (keyOption === 'importLedger') {
            alias = await importKeyFromLedger();
            setAddress(alias, showAddress(alias));
        } else if (keyOption === 'importSecret') {
            alias = await importSecretKey();
            setAddress(alias, showAddress(alias));
        }
    } else {
        alias = await promptForNewKey();
        setAddress(alias, showAddress(alias));
    }

    // Check the balance of the newly selected or created key
    const currentBalance = getBalance(alias);
    if (currentBalance < 6000) {
        console.log(`The balance of ${alias} is ${currentBalance} ꜩ, which is insufficient for delegation.`);

        // Prompt the user to choose how to proceed with funding
        const { fundOption } = await inquirer.prompt([
            {
                type: 'list',
                name: 'fundOption',
                message: `How would you like to proceed to reach 6000 ꜩ?`,
                choices: [
                    'Self-fund',
                    'Use faucet',
                    'Register and Setup with Partial Funds'
                ]
            }
        ]);

        if (fundOption === 'Self-fund') {
            const address = showAddress(alias);
            console.log(`Please send at least 6000 ꜩ to the address ${address}.`);
            await waitForBalance(alias, 6000);
        } else if (fundOption === 'Use faucet') {
            const amountNeeded = 6000 - currentBalance;
            const { amount } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'amount',
                    message: `Enter the amount of ꜩ to request from the faucet (minimum ${amountNeeded} ꜩ):`,
                    validate: value => value >= amountNeeded || `You must request at least ${amountNeeded} ꜩ.`
                }
            ]);
            await useFaucet(alias, network, amount);
            await waitForBalance(alias, 6000);
        } else if (fundOption === 'Register and Setup with Partial Funds') {
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
                const keyIsEncrypted = isKeyEncrypted(alias, knownAddresses);
                if (keyIsEncrypted) {
                    const { password } = await inquirer.prompt([
                        {
                            type: 'password',
                            name: 'password',
                            message: 'Enter the password for the encrypted key:',
                            mask: '*'
                        }
                    ]);

                    const passwordFilePath = `/tmp/${alias}_password.txt`;
                    console.log(`Creating password file at: ${passwordFilePath}`);
                    fs.writeFileSync(passwordFilePath, password);
                    await configureBakerService(dataDir, rpcPort, alias, passwordFilePath);

                    await new Promise(resolve => setTimeout(resolve, 5000));
                    fs.unlinkSync(passwordFilePath);
                } else {
                    await configureBakerService(dataDir, rpcPort, alias);
                }
            }
            return;  // Skip the normal funding process
        }
    } else {
        const { continueBakerSetup } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'continueBakerSetup',
                message: `The balance of ${alias} is sufficient (${currentBalance} ꜩ). Do you want to continue?`,
                default: true
            }
        ]);

        if (!continueBakerSetup) {
            return;
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
        const keyIsEncrypted = isKeyEncrypted(alias, knownAddresses);
        if (keyIsEncrypted) {
            const { password } = await inquirer.prompt([
                {
                    type: 'password',
                    name: 'password',
                    message: 'Enter the password for the encrypted key:',
                    mask: '*'
                }
            ]);

            const passwordFilePath = `/tmp/${alias}_password.txt`;
            console.log(`Creating password file at: ${passwordFilePath}`);
            fs.writeFileSync(passwordFilePath, password);
            await configureBakerService(dataDir, rpcPort, alias, passwordFilePath);

            await new Promise(resolve => setTimeout(resolve, 5000));
            fs.unlinkSync(passwordFilePath);
        } else {
            await configureBakerService(dataDir, rpcPort, alias);
        }
    }

    console.log('Baker setup completed successfully.');
}



// Function to register a key as a delegate on the specified network
function registerAsDelegate(alias, network) {
    try {
        console.log(`Registering ${alias} as a delegate on the ${network} network...`);
        execSync(`octez-client register key ${alias} as delegate`, { stdio: 'inherit' });
        console.log(`Key ${alias} has been registered as a delegate.`);
    } catch (error) {
        console.error(`Failed to register ${alias} as delegate: ${error.message}`);
        throw error;
    }
}


// Function to import a key from a Ledger device
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

// Function to import a secret key by entering it manually
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

// Function to prompt the user to create a new key with a specified alias
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

// Function to wait for a key's balance to reach a minimum threshold
async function waitForBalance(alias, minBalance) {
    console.log(`Waiting for the balance of ${alias} to reach ${minBalance} ꜩ...`);
    while (true) {
        const balance = getBalance(alias);
        if (balance >= minBalance) {
            console.log(`Balance of ${alias} is sufficient: ${formatBalance(balance)} ꜩ.`);
            break;
        } else {
            console.log(`Current balance: ${formatBalance(balance)} ꜩ. Waiting for funds...`);
            await new Promise(resolve => setTimeout(resolve, 10000));  // Wait for 10 seconds before checking again
        }
    }
}

// Exporting functions for use in other modules
module.exports = {
    updateClientConfig,
    checkNodeBootstrapped,
    listKnownAddressesWithBalances,
    generateNewKey,
    showAddress,
    getBalance,
    useFaucet,
    setupBaker,
    getAddress,
    setAddress
};
