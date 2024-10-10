const { installTezosNode, installZcashParams } = require('../lib/packageManager');
const { detectExistingNodes } = require('../lib/detect');
const { setupL1Node } = require('../lib/layer1');
const { installTezosBaker } = require('../lib/packageManager');
const { setupBaker, getAddress } = require('../lib/bakerManager');
const { postBakerSetup } = require('../lib/monitoringManager');
const { getSnapshotSizes } = require('../lib/snapshotManager');
const { getCurrentProtocol, parseNodeProcess, getNodeNetwork } = require('../lib/nodeManager');
const { setupEtherlink } = require('../lib/etherlink');
const {
    askBakerSetup,
    askNewNodeSetup,
    askNetwork,
    askHistoryMode,
    askSetupType,
    askSetupMonitoring,
    askSmartRollupSetup
} = require('../lib/choice');
const inquirer = require('inquirer');

async function main() {
    console.log('Starting the setup process...');
    try {
        // Install Zcash parameters and Tezos binaries
        console.log('Installing Zcash parameters and Tezos binaries...');
        await installZcashParams();
        await installTezosNode();

        console.log('Detecting existing Tezos nodes...');
        const existingNodes = detectExistingNodes();

        // Handle the case of existing Tezos nodes
        if (existingNodes.length > 0) {
            console.log('Existing Tezos nodes detected:');
            existingNodes.forEach(node => console.log(`- ${node}`));

            // Ask the user if they want to set up a baker on the existing node
            const setupBakerOption = await askBakerSetup();
            console.log(`User chose to set up a baker: ${setupBakerOption}`);
            if (setupBakerOption) {
                const { rpcPort: detectedRpcPort, dataDir: detectedDataDir } = parseNodeProcess(existingNodes[0]);
                const network = getNodeNetwork(detectedDataDir);
                console.log('Setting up baker on existing node...');
                await setupBakerOnExistingNode(detectedRpcPort, detectedDataDir, network);
                return;
            }
        } else {
            console.log('No existing Tezos nodes found.');
        }

        // If no existing nodes or baker was chosen, ask what to set up next
        console.log('Prompting the user for the next action ...');
        const setupType = await askSetupType();
        console.log(`User selected setup type: ${setupType}`);

        // Handle the user choosing to set up Etherlink (Smart Rollup + EVM)
        if (setupType === 'smartRollup') {
            console.log('Starting Etherlink setup...');
            await setupEtherlink();
            console.log('Etherlink setup completed.');
            return;
        }

        // If "Node only" or "Node + Baker" is chosen, proceed to set up the L1 node
        let network;
        if (setupType === 'nodeAndBaker' || setupType === 'nodeOnly') {
            console.log('Prompting user for network selection...');
            network = await askNetwork();
            const snapshotSizes = await getSnapshotSizes(network);
            const mode = await askHistoryMode(snapshotSizes);

            console.log('Setting up L1 node...');
            const { rpcPort, netPort, dataDir, protocolHash } = await setupL1Node(network, mode);

            if (setupType === 'nodeAndBaker') {
                console.log('Setting up baker on new node...');
                await setupBakerOnNewNode(rpcPort, dataDir, network, protocolHash);
            }

            console.log('Installation completed.');
            process.exit(0);
        }

        // If "Baker only" is chosen, set up a baker on the existing node
        if (setupType === 'bakerOnly') {
            console.log('Setting up baker only...');
            const { rpcPort: detectedRpcPort, dataDir: detectedDataDir } = parseNodeProcess(existingNodes[0]);
            const rpcPort = detectedRpcPort;
            const dataDir = detectedDataDir;
            const network = getNodeNetwork(dataDir);

            await setupBakerOnExistingNode(rpcPort, dataDir, network);
        }
    } catch (error) {
        console.error('An error occurred during the setup:', error.message);
        process.exit(1);
    }
}

// Setup baker on an existing node
async function setupBakerOnExistingNode(rpcPort, dataDir, network) {
    console.log('Starting baker setup on an existing node...');
    let protocolHash;
    try {
        protocolHash = await getCurrentProtocol(rpcPort);
        console.log(`Current protocol: ${protocolHash}`);

        await installTezosBaker(protocolHash);
        console.log(`Setting up a baker on the existing node using RPC port ${rpcPort} and network ${network}...`);
        await setupBaker(dataDir, rpcPort, network);

        const selectedBakerAddress = getAddress().address;
        const setupMonitoring = await askSetupMonitoring();
        if (setupMonitoring) {
            console.log(`Selected Baker Address: ${selectedBakerAddress}`);
            await postBakerSetup();
        }
    } catch (error) {
        console.error(`Error setting up baker on existing node: ${error.message}`);
        process.exit(1);
    }
}

// Setup baker on a new node
async function setupBakerOnNewNode(rpcPort, dataDir, network, protocolHash) {
    console.log('Starting baker setup on a new node...');
    try {
        await installTezosBaker(protocolHash);
        await setupBaker(dataDir, rpcPort, network);

        const selectedBakerAddress = getAddress().address;
        const setupMonitoring = await askSetupMonitoring();
        if (setupMonitoring) {
            console.log(`Selected Baker Address: ${selectedBakerAddress}`);
            await postBakerSetup();
        }
    } catch (error) {
        console.error(`Error setting up baker on new node: ${error.message}`);
        process.exit(1);
    }
}

main();
