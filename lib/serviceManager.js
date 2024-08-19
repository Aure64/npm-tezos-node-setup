const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const axios = require('axios');

// Function to configure the Tezos Node service
async function configureServiceUnit(dataDir, rpcPort, netPort, serviceName) {
    // Content of the systemd service file for the Tezos Node
    const serviceUnitContent = `
[Unit]
Description=Tezos Node Service
After=network.target

[Service]
ExecStart=/usr/bin/octez-node run --rpc-addr 127.0.0.1:${rpcPort} --net-addr 0.0.0.0:${netPort} --data-dir ${dataDir}
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
`;

    const servicePath = `/etc/systemd/system/${serviceName}.service`;

    // Create the systemd service file
    try {
        console.log(`Creating service file: ${servicePath}`);
        execSync(`sudo touch ${servicePath}`);
        execSync(`sudo chmod 666 ${servicePath}`);
        fs.writeFileSync(servicePath, serviceUnitContent);
        console.log(`Service file ${servicePath} created successfully.`);
        execSync(`sudo chmod 644 ${servicePath}`);
    } catch (error) {
        console.error(`Error while creating service file: ${error.message}`);
        throw error;
    }

    // Enable and start the systemd service
    try {
        console.log(`Enabling and starting service: ${serviceName}`);
        execSync(`sudo systemctl enable ${serviceName}`);
        execSync(`sudo systemctl start ${serviceName}`);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds
        execSync(`sudo systemctl restart ${serviceName}`);
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for 3 seconds

        console.log(`Service ${serviceName} started successfully.`);
    } catch (error) {
        console.error(`Error while enabling/starting service: ${error.message}`);
        throw error;
    }
}

// Function to get the current Tezos protocol
async function getCurrentProtocol(rpcPort) {
    try {
        const response = await axios.get(`http://127.0.0.1:${rpcPort}/chains/main/blocks/head`);
        return response.data.protocol;
    } catch (error) {
        console.error('Failed to retrieve current protocol:', error.message);
        throw error;
    }
}

// Function to configure the Tezos Baker service
async function configureBakerService(dataDir, rpcPort, alias, passwordFilePath = null) {
    const protocolHash = await getCurrentProtocol(rpcPort);

    // List available baker binaries
    const bakerBinaries = execSync('ls /usr/bin/octez-baker-*').toString().split('\n').map(file => path.basename(file));

    // Find the binary corresponding to the protocol hash
    const bakerBinary = bakerBinaries.find(binary => binary.includes(protocolHash.slice(0, 8)));

    if (!bakerBinary) {
        throw new Error(`No corresponding baker binary found for protocol ${protocolHash}`);
    }

    // Default content of the systemd service file for the Tezos Baker
    let serviceUnitContent = `
[Unit]
Description=Tezos Baker Service
After=network.target

[Service]
ExecStart=/usr/bin/${bakerBinary} --base-dir /home/ubuntu/.tezos-client run with local node ${dataDir} ${alias} --liquidity-baking-toggle-vote pass
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
`;

    // If a password file is provided, modify the service file to use it
    if (passwordFilePath) {
        serviceUnitContent = `
[Unit]
Description=Tezos Baker Service
After=network.target

[Service]
ExecStart=/usr/bin/${bakerBinary} --base-dir /home/ubuntu/.tezos-client -f ${passwordFilePath} run with local node ${dataDir} ${alias} --liquidity-baking-toggle-vote pass
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
`;
        console.log(`Configuring service with password file: ${passwordFilePath}`);
    }

    const servicePath = `/etc/systemd/system/${alias}.service`;

    // Create the systemd service file
    try {
        console.log(`Writing service file: ${servicePath}`);
        execSync(`sudo touch ${servicePath}`);
        execSync(`sudo chmod 666 ${servicePath}`);
        fs.writeFileSync(servicePath, serviceUnitContent);
        console.log(`Service file ${servicePath} written successfully.`);
        execSync(`sudo chmod 644 ${servicePath}`);
    } catch (error) {
        console.error(`Error while writing service file: ${error.message}`);
        throw error;
    }

    // Enable and start the systemd service
    try {
        console.log(`Enabling and starting service: ${alias}`);
        execSync(`sudo systemctl enable ${alias}`);
        execSync(`sudo systemctl start ${alias}`);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds
        execSync(`sudo systemctl restart ${alias}`);
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for 3 seconds
        console.log(`Service ${alias} started successfully.`);
    } catch (error) {
        console.error(`Error while enabling/starting service: ${error.message}`);
        throw error;
    }
}

// Export the functions for external use
module.exports = {
    configureServiceUnit,
    configureBakerService,
};
