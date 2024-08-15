const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const axios = require('axios');

// Fonction pour configurer le service Tezos Node
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

// Fonction pour récupérer le protocole Tezos actuel
async function getCurrentProtocol(rpcPort) {
    try {
        const response = await axios.get(`http://127.0.0.1:${rpcPort}/chains/main/blocks/head`);
        return response.data.protocol;
    } catch (error) {
        console.error('Failed to retrieve current protocol:', error.message);
        throw error;
    }
}

// Fonction pour configurer le service Tezos Baker sans encryption
async function configureBakerServiceWithoutEncryption(dataDir, rpcPort, alias, serviceName) {
    const protocolHash = await getCurrentProtocol(rpcPort);

    // Liste des binaires disponibles
    const bakerBinaries = execSync('ls /usr/bin/octez-baker-*').toString().split('\n').map(file => path.basename(file));

    // Trouver le binaire correspondant au hash du protocole
    const bakerBinary = bakerBinaries.find(binary => binary.includes(protocolHash.slice(0, 8)));

    if (!bakerBinary) {
        throw new Error(`Aucun binaire baker correspondant trouvé pour le protocole ${protocolHash}`);
    }

    const serviceUnitContent = `
[Unit]
Description=Tezos Baker Service
After=network.target

[Service]
ExecStart=/usr/bin/${bakerBinary} run with local node ${dataDir} ${alias} --liquidity-baking-toggle-vote pass
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

// Fonction pour configurer le service Tezos Baker avec encryption
async function configureBakerServiceWithEncryption(dataDir, rpcPort, alias, serviceName, passwordFilePath) {
    const protocolHash = await getCurrentProtocol(rpcPort);

    // Liste des binaires disponibles
    const bakerBinaries = execSync('ls /usr/bin/octez-baker-*').toString().split('\n').map(file => path.basename(file));

    // Trouver le binaire correspondant au hash du protocole
    const bakerBinary = bakerBinaries.find(binary => binary.includes(protocolHash.slice(0, 8)));

    if (!bakerBinary) {
        throw new Error(`Aucun binaire baker correspondant trouvé pour le protocole ${protocolHash}`);
    }

    const serviceUnitContent = `
[Unit]
Description=Tezos Baker Service
After=network.target

[Service]
ExecStart=/usr/bin/${bakerBinary} -f ${passwordFilePath} run with local node ${dataDir} ${alias} --liquidity-baking-toggle-vote pass
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

module.exports = {
    configureServiceUnit,
    configureBakerServiceWithoutEncryption,
    configureBakerServiceWithEncryption,
};
