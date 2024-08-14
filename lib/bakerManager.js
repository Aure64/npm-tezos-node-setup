const { execSync, exec } = require('child_process');
const inquirer = require('inquirer');


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

    const faucetProcess = exec(`npx @oxheadalpha/get-tez ${address} --amount ${amount} --network ${network}`);

    faucetProcess.stdout.on('data', (data) => {
        console.log(data.toString());
    });

    faucetProcess.stderr.on('data', (data) => {
        console.error(data.toString());
    });

    faucetProcess.on('close', (code) => {
        if (code === 0) {
            console.log('Faucet operation completed successfully.');
        } else {
            console.error(`Faucet operation failed with code ${code}.`);
        }
    });
}

async function setupBaker(rpcPort, network) {
    updateClientConfig(rpcPort);
    checkNodeBootstrapped();

    const knownAddresses = listKnownAddresses();
    let alias;

    if (knownAddresses.length > 0) {
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
                    choices: knownAddresses
                }
            ]);
            alias = selectedAddress.split(':')[0].trim();
        } else {
            alias = await promptForNewKey();
        }
    } else {
        alias = await promptForNewKey();
    }

    const { fundOption } = await inquirer.prompt([
        {
            type: 'list',
            name: 'fundOption',
            message: 'How would you like to fund the baker key?',
            choices: ['Self-fund', 'Use faucet']
        }
    ]);

    if (fundOption === 'Self-fund') {
        const address = showAddress(alias);
        console.log(`Please send at least 6000 ꜩ to the address ${address}.`);
        await waitForBalance(alias, 6000);
    } else {
        const { amount } = await inquirer.prompt([
            {
                type: 'input',
                name: 'amount',
                message: 'Enter the amount of ꜩ to request from the faucet (minimum 6000 ꜩ):',
                validate: value => value >= 6000 || 'You must request at least 6000 ꜩ.'
            }
        ]);
        useFaucet(alias, network, amount);
        await waitForBalance(alias, 6000);
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
    listKnownAddresses,
    generateNewKey,
    showAddress,
    getBalance,
    useFaucet,
    setupBaker
};
