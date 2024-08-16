const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const axios = require('axios');

// Function to configure the Tezos Node service
function configureServiceUnit(dataDir, rpcPort, netPort, serviceName) {
    const serviceUnitContent = `
[Unit]
Description=Tezos Node Service
After=network.target

[Service]
ExecStart=/usr/bin/octez-node run --rpc-addr 127.0.0.1:${rpcPort} --net-addr 0.0.0.0:${netPort} --data-dir ${dataDir}
Restart=on-failure

[Install]
WantedBy=multi-user.target
`;

    const servicePath = `/etc/systemd/system/${serviceName}.service`;
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

    try {
        console.log(`Enabling and starting service: ${serviceName}`);
        execSync(`sudo systemctl enable ${serviceName}`);

        execSync(`sudo systemctl start ${serviceName}`);
        //execSync(`sudo systemctl restart ${serviceName}`);

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

    let serviceUnitContent = `
[Unit]
Description=Tezos Baker Service
After=network.target

[Service]
ExecStart=/usr/bin/${bakerBinary} --base-dir /home/ubuntu/.tezos-client run with local node ${dataDir} ${alias} --liquidity-baking-toggle-vote pass
Restart=on-failure

[Install]
WantedBy=multi-user.target
`;

    if (passwordFilePath) {
        serviceUnitContent = `
[Unit]
Description=Tezos Baker Service
After=network.target

[Service]
ExecStart=/usr/bin/${bakerBinary} --base-dir /home/ubuntu/.tezos-client -f ${passwordFilePath} run with local node ${dataDir} ${alias} --liquidity-baking-toggle-vote pass
Restart=on-failure

[Install]
WantedBy=multi-user.target
`;
        console.log(`Configuring service with password file: ${passwordFilePath}`);
    }

    const servicePath = `/etc/systemd/system/${alias}.service`;
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

    try {
        console.log(`Enabling and starting service: ${alias}`);
        execSync(`sudo systemctl enable ${alias}`);
        console.log('Waiting for 3 seconds before starting the service...');
        execSync('sleep 3');
        execSync(`sudo systemctl start ${alias}`);
        console.log(`Service ${alias} started successfully.`);
    } catch (error) {
        console.error(`Error while enabling/starting service: ${error.message}`);
        throw error;
    }
}

module.exports = {
    configureServiceUnit,
    configureBakerService,
};
