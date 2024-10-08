const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const axios = require('axios');

const userHomeDir = process.env.HOME; // Répertoire de base de l'utilisateur

// Function to sanitize service names by removing accents but keeping hyphens and underscores intact
function sanitizeServiceName(name) {
    return name.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/[^a-zA-Z0-9_-]/g, '_'); // Replace non-alphanumeric characters except hyphens and underscores with an underscore
}

// Function to configure the Tezos Node service
async function configureServiceUnit(dataDir, rpcPort, netPort, serviceName) {
    // Sanitize service name to handle special characters
    const sanitizedServiceName = sanitizeServiceName(serviceName);

    // Content of the systemd service file for the Tezos Node
    const serviceUnitContent = `
[Unit]
Description=Tezos Node Service
After=network.target

[Service]
ExecStart=/usr/bin/octez-node run --rpc-addr 127.0.0.1:${rpcPort} --net-addr 0.0.0.0:${netPort} --data-dir "${dataDir}"
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
`;

    const servicePath = `/etc/systemd/system/${sanitizedServiceName}.service`;

    // Create the systemd service file
    try {
        console.log(`Creating service file: ${servicePath}`);
        execSync(`sudo touch "${servicePath}"`);
        execSync(`sudo chmod 666 "${servicePath}"`);
        fs.writeFileSync(servicePath, serviceUnitContent);
        console.log(`Service file ${servicePath} created successfully.`);
        execSync(`sudo chmod 644 "${servicePath}"`);
    } catch (error) {
        console.error(`Error while creating service file: ${error.message}`);
        throw error;
    }

    // Enable and start the systemd service
    try {
        console.log(`Enabling and starting service: ${sanitizedServiceName}`);
        execSync(`sudo systemctl enable "${sanitizedServiceName}.service"`);
        execSync(`sudo systemctl start "${sanitizedServiceName}.service"`);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds
        execSync(`sudo systemctl restart "${sanitizedServiceName}.service"`);
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for 3 seconds

        console.log(`Service ${sanitizedServiceName} started successfully.`);
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
    // Sanitize alias to handle special characters
    const sanitizedAlias = sanitizeServiceName(alias);

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
ExecStart=/usr/bin/${bakerBinary} --base-dir ${userHomeDir}/.tezos-client run with local node "${dataDir}" ${sanitizedAlias} --liquidity-baking-toggle-vote pass
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
ExecStart=/usr/bin/${bakerBinary} --base-dir ${userHomeDir}/.tezos-client -f "${passwordFilePath}" run with local node "${dataDir}" ${sanitizedAlias} --liquidity-baking-toggle-vote pass
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
`;
        console.log(`Configuring service with password file: ${passwordFilePath}`);
    }

    const servicePath = `/etc/systemd/system/${sanitizedAlias}.service`;

    // Create the systemd service file
    try {
        console.log(`Writing service file: ${servicePath}`);
        execSync(`sudo touch "${servicePath}"`);
        execSync(`sudo chmod 666 "${servicePath}"`);
        fs.writeFileSync(servicePath, serviceUnitContent);
        console.log(`Service file ${servicePath} written successfully.`);
        execSync(`sudo chmod 644 "${servicePath}"`);
    } catch (error) {
        console.error(`Error while writing service file: ${error.message}`);
        throw error;
    }

    // Enable and start the systemd service
    try {
        console.log(`Enabling and starting service: ${sanitizedAlias}`);
        execSync(`sudo systemctl enable "${sanitizedAlias}.service"`);
        execSync(`sudo systemctl start "${sanitizedAlias}.service"`);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds
        execSync(`sudo systemctl restart "${sanitizedAlias}.service"`);
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for 3 seconds
        console.log(`Service ${sanitizedAlias} started successfully.`);
    } catch (error) {
        console.error(`Error while enabling/starting service: ${error.message}`);
        throw error;
    }
}

// Function to configure the Pyrometer service with automatic detection of the binary path
async function configurePyrometerService(monitoringDir) {
    const serviceUnitContent = `
[Unit]
Description=Tezos Pyrometer Service
After=network.target

[Service]
ExecStart=/bin/bash -c "source ${userHomeDir}/.nvm/nvm.sh && \$(nvm which current | xargs dirname)/pyrometer run -c '${monitoringDir}/pyrometer.toml' -d '${monitoringDir}/data'"
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
`;

    const servicePath = `/etc/systemd/system/tezos-pyrometer.service`;

    // Create the systemd service file
    try {
        console.log(`Creating Pyrometer service file: ${servicePath}`);
        execSync(`sudo touch "${servicePath}"`);
        execSync(`sudo chmod 666 "${servicePath}"`);
        fs.writeFileSync(servicePath, serviceUnitContent);
        console.log(`Pyrometer service file ${servicePath} created successfully.`);
        execSync(`sudo chmod 644 "${servicePath}"`);
    } catch (error) {
        console.error(`Error while creating Pyrometer service file: ${error.message}`);
        throw error;
    }

    // Enable and start the systemd service
    try {
        console.log(`Enabling and starting Pyrometer service...`);
        execSync(`sudo systemctl enable "tezos-pyrometer.service"`);
        execSync(`sudo systemctl start "tezos-pyrometer.service"`);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds
        execSync(`sudo systemctl restart "tezos-pyrometer.service"`);
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for 3 seconds
        console.log(`Pyrometer service started successfully : http://localhost:2020.`);
    } catch (error) {
        console.error(`Error while enabling/starting Pyrometer service: ${error.message}`);
        throw error;
    }
}

module.exports = {
    configureServiceUnit,
    configureBakerService,
    configurePyrometerService
};
