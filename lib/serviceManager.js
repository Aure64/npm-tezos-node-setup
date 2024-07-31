const fs = require('fs');
const sudo = require('sudo-prompt');

function configureServiceUnit(dataDir, rpcPort, netPort, serviceName) {
    const serviceUnit = `
[Unit]
Description=Tezos Node Service for ${serviceName}
After=network.target

[Service]
ExecStart=/usr/bin/octez-node run --rpc-addr 127.0.0.1:${rpcPort} --net-addr 0.0.0.0:${netPort} --data-dir ${dataDir}
Restart=always
User=${process.env.USER}

[Install]
WantedBy=multi-user.target
    `;
    const servicePath = `/etc/systemd/system/${serviceName}.service`;

    const options = { name: 'Tezos Node Setup' };
    sudo.exec(`echo "${serviceUnit}" | sudo tee ${servicePath}`, options, (error, stdout, stderr) => {
        if (error) {
            console.error(`Erreur lors de la création du fichier service: ${error}`);
            return;
        }
        sudo.exec(`sudo systemctl daemon-reload && sudo systemctl enable ${serviceName} && sudo systemctl start ${serviceName}`, options, (error, stdout, stderr) => {
            if (error) {
                console.error(`Erreur lors de la configuration du service systemd: ${error}`);
                return;
            }
            console.log('Service systemd configuré et démarré avec succès.');
        });
    });
}

module.exports = configureServiceUnit;
