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

// Function to create, enable, and start a systemd service with validation
async function configureServiceUnit(dataDir, rpcPort, netPort, serviceName) {
    const sanitizedServiceName = sanitizeServiceName(serviceName);

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

    try {
        // Create the systemd service file
        console.log(`Creating service file: ${servicePath}`);
        fs.writeFileSync(servicePath, serviceUnitContent, { mode: 0o644 });
        console.log(`Service file ${servicePath} created successfully.`);

        // Enable the systemd service
        console.log(`Enabling service: ${sanitizedServiceName}`);
        execSync(`sudo systemctl enable "${sanitizedServiceName}.service"`, { stdio: 'inherit' });

        // Start the systemd service
        console.log(`Starting service: ${sanitizedServiceName}`);
        execSync(`sudo systemctl start "${sanitizedServiceName}.service"`, { stdio: 'inherit' });

        // Wait briefly to allow the service to start
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Restart the systemd service to ensure it is fully operational
        console.log(`Restarting service: ${sanitizedServiceName}`);
        execSync(`sudo systemctl restart "${sanitizedServiceName}.service"`, { stdio: 'inherit' });

        // Validate that the service is active
        validateServiceStatus(sanitizedServiceName);
        console.log(`Service ${sanitizedServiceName} started and validated successfully.`);
    } catch (error) {
        console.error(`Error configuring service ${sanitizedServiceName}: ${error.message}`);
        throw error;
    }
}

// Function to validate if a systemd service is active
function validateServiceStatus(serviceName) {
    try {
        const status = execSync(`sudo systemctl is-active "${serviceName}.service"`).toString().trim();
        if (status !== 'active') {
            throw new Error(`Service ${serviceName} is not active. Status: ${status}`);
        }
    } catch (error) {
        console.error(`Failed to validate service status: ${error.message}`);
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
    const sanitizedAlias = sanitizeServiceName(alias);
    const protocolHash = await getCurrentProtocol(rpcPort);

    // List available baker binaries
    const bakerBinaries = execSync('ls /usr/bin/octez-baker-*').toString().split('\n').map(file => path.basename(file));
    const bakerBinary = bakerBinaries.find(binary => binary.includes(protocolHash.slice(0, 8)));

    if (!bakerBinary) {
        throw new Error(`No corresponding baker binary found for protocol ${protocolHash}`);
    }

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

    try {
        console.log(`Writing service file: ${servicePath}`);
        fs.writeFileSync(servicePath, serviceUnitContent, { mode: 0o644 });
        console.log(`Service file ${servicePath} written successfully.`);

        console.log(`Enabling service: ${sanitizedAlias}`);
        execSync(`sudo systemctl enable "${sanitizedAlias}.service"`, { stdio: 'inherit' });

        console.log(`Starting service: ${sanitizedAlias}`);
        execSync(`sudo systemctl start "${sanitizedAlias}.service"`, { stdio: 'inherit' });

        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds

        console.log(`Restarting service: ${sanitizedAlias}`);
        execSync(`sudo systemctl restart "${sanitizedAlias}.service"`, { stdio: 'inherit' });

        validateServiceStatus(sanitizedAlias);
        console.log(`Baker service ${sanitizedAlias} started and validated successfully.`);
    } catch (error) {
        console.error(`Error configuring baker service ${sanitizedAlias}: ${error.message}`);
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

    try {
        console.log(`Creating Pyrometer service file: ${servicePath}`);
        fs.writeFileSync(servicePath, serviceUnitContent, { mode: 0o644 });
        console.log(`Pyrometer service file ${servicePath} created successfully.`);

        console.log(`Enabling service: tezos-pyrometer`);
        execSync(`sudo systemctl enable "tezos-pyrometer.service"`, { stdio: 'inherit' });

        console.log(`Starting service: tezos-pyrometer`);
        execSync(`sudo systemctl start "tezos-pyrometer.service"`, { stdio: 'inherit' });

        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds

        console.log(`Restarting service: tezos-pyrometer`);
        execSync(`sudo systemctl restart "tezos-pyrometer.service"`, { stdio: 'inherit' });

        validateServiceStatus('tezos-pyrometer');
        console.log(`Pyrometer service started and validated successfully.`);
    } catch (error) {
        console.error(`Error configuring Pyrometer service: ${error.message}`);
        throw error;
    }
}

module.exports = {
    configureServiceUnit,
    configureBakerService,
    configurePyrometerService
};
