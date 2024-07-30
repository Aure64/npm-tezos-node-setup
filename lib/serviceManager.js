const fs = require('fs');
const path = require('path');

function configureServiceUnit(dataDir, rpcPort, netPort, serviceName) {
    const serviceUnitContent = `
[Unit]
Description=Tezos Node Service
Documentation=http://tezos.gitlab.io/
After=network.target

[Service]
User=${process.env.USER}
ExecStart=/usr/bin/octez-node run --rpc-addr 127.0.0.1:${rpcPort} --net-addr 0.0.0.0:${netPort} --data-dir ${dataDir}
Restart=on-failure
ExecStop=/bin/kill -s SIGINT $MAINPID

[Install]
WantedBy=multi-user.target
`;

    const servicePath = `/etc/systemd/system/${serviceName}.service`;
    fs.writeFileSync(servicePath, serviceUnitContent);
    execSync(`sudo systemctl daemon-reload`);
    execSync(`sudo systemctl enable ${serviceName}`);
    execSync(`sudo systemctl start ${serviceName}`);
}

module.exports = configureServiceUnit;
