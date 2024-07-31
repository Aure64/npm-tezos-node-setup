const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
        console.log(`Écriture du fichier de service : ${servicePath}`);
        execSync(`sudo touch ${servicePath}`);
        execSync(`sudo chmod 666 ${servicePath}`);
        fs.writeFileSync(servicePath, serviceUnitContent);
        console.log(`Fichier de service ${servicePath} écrit avec succès.`);
        execSync(`sudo chmod 644 ${servicePath}`);
    } catch (error) {
        console.error(`Erreur lors de l'écriture du fichier de service: ${error.message}`);
        throw error;
    }

    try {
        console.log(`Activation et démarrage du service : ${serviceName}`);
        execSync(`sudo systemctl enable ${serviceName}`);
        execSync(`sudo systemctl start ${serviceName}`);
        console.log(`Service ${serviceName} démarré.`);
    } catch (error) {
        console.error(`Erreur lors de l'activation/démarrage du service: ${error.message}`);
        throw error;
    }
}

module.exports = configureServiceUnit;
