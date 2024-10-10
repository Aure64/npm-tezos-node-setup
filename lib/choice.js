const inquirer = require('inquirer');
const path = require('path');

// Function to ask whether to set up a baker on an existing node
async function askBakerSetup() {
    const { setupBakerOption } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'setupBakerOption',
            message: 'Tezos nodes are already running. Do you want to set up a baker on the existing node?',
            default: true
        }
    ]);
    return setupBakerOption;
}

// Function to ask if the user wants to set up a new Tezos node
async function askNewNodeSetup() {
    const { setupNewNode } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'setupNewNode',
            message: 'Do you want to create a new Tezos node?',
            default: false
        }
    ]);
    return setupNewNode;
}

// Function to ask the user to select the network
async function askNetwork() {
    const { networkAnswer } = await inquirer.prompt([
        {
            type: 'list',
            name: 'networkAnswer',
            message: 'Choose the network:',
            choices: ['mainnet', 'ghostnet']
        }
    ]);
    return networkAnswer;
}

// Function to ask the user to choose the history mode for the node
async function askHistoryMode(snapshotSizes) {
    const { mode } = await inquirer.prompt([
        {
            type: 'list',
            name: 'mode',
            message: 'Choose the mode:',
            choices: [
                { name: `full (${snapshotSizes.full} GB)`, value: 'full' },
                { name: `rolling (${snapshotSizes.rolling} GB)`, value: 'rolling' }
            ]
        }
    ]);
    return mode;
}

// Function to ask the user what they would like to set up
async function askSetupType() {
    const { setupType } = await inquirer.prompt([
        {
            type: 'list',
            name: 'setupType',
            message: 'What would you like to set up?',
            choices: [
                { name: 'Node only', value: 'nodeOnly' },
                { name: 'Node + Baker', value: 'nodeAndBaker' },
                { name: 'Baker only (on an existing node)', value: 'bakerOnly' },
                { name: 'Smart Rollup + EVM Node (on an existing node)', value: 'smartRollup' }
            ]
        }
    ]);
    return setupType;
}

// Function to ask for snapshot import mode (fast or safe)
async function askSnapshotImportMode() {
    const { fastMode } = await inquirer.prompt([
        {
            type: 'list',
            name: 'fastMode',
            message: 'Choose the import mode:',
            choices: [
                { name: 'Fast mode (no checks)', value: true },
                { name: 'Safe mode (with checks)', value: false }
            ]
        }
    ]);
    return fastMode;
}

// Function to ask the user whether to set up monitoring for the baker
async function askSetupMonitoring() {
    const { setupMonitoring } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'setupMonitoring',
            message: 'Do you want to set up monitoring for the baker?',
            default: true
        }
    ]);
    return setupMonitoring;
}

// Function to ask the user about setting up a Smart Rollup + EVM Node
async function askSmartRollupSetup() {
    const { setupSmartRollup } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'setupSmartRollup',
            message: 'Do you want to set up a Smart Rollup + EVM Node?',
            default: true
        }
    ]);
    return setupSmartRollup;
}

// Function to ask for RPC and network ports
async function askRpcAndNetPorts() {
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'rpcPort',
            message: 'Enter the RPC port to use (or press Enter to use the default port 8732):',
            default: '8732'
        },
        {
            type: 'input',
            name: 'netPort',
            message: 'Enter the network port to use (or press Enter to use the default port 9732):',
            default: '9732'
        }
    ]);
    return answers;
}

// Reusable function to ask for directory location and name
async function askDirectoryLocation(defaultDir = process.env.HOME, message = 'Enter the path where the directory should be created:') {
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'dirName',
            message: 'Enter the name for the data directory (default is tezos-node):',
            default: 'tezos-node'
        },
        {
            type: 'input',
            name: 'dirPath',
            message,
            default: defaultDir
        }
    ]);
    return answers;
}

// Reusable function to confirm directory deletion
async function askConfirmDirectoryDeletion(directory) {
    const { confirmDeletion } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirmDeletion',
            message: `The directory ${directory} already exists. Do you want to delete it?`,
            default: false
        }
    ]);
    return confirmDeletion;
}

// Function to ask for monitoring directory (reused from askDirectoryLocation)
async function askMonitoringDirectory(defaultDir = path.join(process.env.HOME, 'tezos-monitoring')) {
    return askDirectoryLocation(defaultDir, 'Enter the path where the monitoring directory should be created:');
}

// Function to ask for the RPC port of the Tezos node for monitoring
async function askRpcPortForMonitoring(runningNodes) {
    const { chosenRpcPort } = await inquirer.prompt([
        {
            type: 'list',
            name: 'chosenRpcPort',
            message: 'Select the RPC port of the Tezos node you want to monitor:',
            choices: runningNodes
        }
    ]);
    return chosenRpcPort;
}

// Reusable function to ask for key option
async function askKeyOption() {
    const { keyOption } = await inquirer.prompt([
        {
            type: 'list',
            name: 'keyOption',
            message: 'What would you like to do?',
            choices: [
                { name: 'Use an existing key', value: 'useExisting' },
                { name: 'Create a new key', value: 'createNew' },
                { name: 'Import a key from a Ledger', value: 'importLedger' },
                { name: 'Import a secret key', value: 'importSecret' }
            ]
        }
    ]);
    return keyOption;
}

// Reusable function to ask for existing key selection
async function askUseExistingKey(knownAddresses) {
    const { selectedAddress } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedAddress',
            message: 'Choose an existing address:',
            choices: knownAddresses
        }
    ]);
    return selectedAddress;
}

// Function to ask for funding option when balance is low
async function askFundOption(currentBalance) {
    const { fundOption } = await inquirer.prompt([
        {
            type: 'list',
            name: 'fundOption',
            message: `The balance is ${currentBalance} ꜩ. How would you like to proceed?`,
            choices: ['Self-fund', 'Use faucet', 'Register and Setup with Partial Funds']
        }
    ]);
    return fundOption;
}

// Function to ask for faucet amount
async function askFaucetAmount(minimumAmount) {
    const { amount } = await inquirer.prompt([
        {
            type: 'input',
            name: 'amount',
            message: `Enter the amount of ꜩ to request from the faucet (minimum ${minimumAmount} ꜩ):`,
            validate: value => value >= minimumAmount || `You must request at least ${minimumAmount} ꜩ.`
        }
    ]);
    return amount;
}

// Function to confirm service setup for baker
async function askSetupService() {
    const { setupService } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'setupService',
            message: 'Do you want to setup and start the baker service?',
            default: true
        }
    ]);
    return setupService;
}

// Function to ask for password for encrypted key
async function askForPassword() {
    const { password } = await inquirer.prompt([
        {
            type: 'password',
            name: 'password',
            message: 'Enter the password for the encrypted key:',
            mask: '*'
        }
    ]);
    return password;
}

// Function to confirm retry of delegate registration
async function askConfirmRetryRegistration(alias, address) {
    const { retry } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'retry',
            message: `Would you like to retry registering ${alias} after sending funds to ${address}?`,
            default: true
        }
    ]);
    return retry;
}

// Function to ask for ledger path when importing key from Ledger
async function askLedgerPath() {
    const { ledgerPath } = await inquirer.prompt([
        {
            type: 'input',
            name: 'ledgerPath',
            message: 'Enter the ledger path (e.g., ledger://0):'
        }
    ]);
    return ledgerPath;
}

// Function to ask for secret key when importing key
async function askSecretKey() {
    const { secretKey } = await inquirer.prompt([
        {
            type: 'password',
            name: 'secretKey',
            message: 'Enter the secret key:',
            mask: '*'
        }
    ]);
    return secretKey;
}

// Function to ask for ledger setup confirmation
async function askSetupLedgerOption() {
    const { setupLedgerOption } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'setupLedgerOption',
            message: 'Do you want to setup your Ledger to bake for your address?',
            default: false
        }
    ]);
    return setupLedgerOption;
}

module.exports = {
    askBakerSetup,
    askNewNodeSetup,
    askNetwork,
    askHistoryMode,
    askSetupType,
    askSnapshotImportMode,
    askSetupMonitoring,
    askSmartRollupSetup,
    askRpcAndNetPorts,
    askDirectoryLocation,
    askConfirmDirectoryDeletion,
    askMonitoringDirectory,
    askRpcPortForMonitoring,
    askKeyOption,
    askUseExistingKey,
    askFundOption,
    askFaucetAmount,
    askSetupService,
    askForPassword,
    askConfirmRetryRegistration,
    askLedgerPath,
    askSecretKey,
    askSetupLedgerOption
};
