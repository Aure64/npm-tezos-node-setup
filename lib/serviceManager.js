const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const SERVICE_FILE_PATH = '/etc/systemd/system/octez-node.service';

function configureServiceUnit(dataDir, rpcPort, netPort) {
    console.log('Configuration du fichier service unit systemd...');
    const user = os.userInfo().username;
    const serviceUnitContent = `
[Unit]
Description=Tezos Node Service
Documentation=http://tezos.gitlab.io/
Wants=network-online.target
After=network-online.target

[Service]
User=${user}
Group=${user}
WorkingDirectory=${dataDir}
ExecStart=/usr/bin/octez-node run --rpc-addr 127.0.0.1:${rpcPort} --net-addr 0.0.0.0:${netPort} --data-dir ${dataDir}
Restart=on-failure

[Install]
WantedBy=multi-user.target
RequiredBy=octez-baker.service octez-accuser.service
  `;

    // Utilisation de sudo pour écrire le fichier de service systemd
    const tmpServiceFilePath = '/tmp/octez-node.service';
    fs.writeFileSync(tmpServiceFilePath, serviceUnitContent);
    execSync(`sudo mv ${tmpServiceFilePath} ${SERVICE_FILE_PATH}`);
    console.log('Fichier service unit configuré.');
    restartService();
}

function restartService() {
    console.log('Redémarrage du service systemd...');
    execSync('sudo systemctl daemon-reload');
    execSync('sudo systemctl enable octez-node');
    execSync('sudo systemctl restart octez-node');
}

module.exports = configureServiceUnit;
