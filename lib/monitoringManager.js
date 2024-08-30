const { execSync } = require('child_process');
const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');

// Importer les modules nécessaires pour obtenir l'adresse du baker et le port RPC
const { setupBaker, showAddress } = require('./bakerManager');
const { parseNodeProcess } = require('./nodeManager');

async function setupPyrometer(bakerAddress, rpcPort) {
    console.log('Setting up Pyrometer for monitoring the baker...');

    // Vérification de l'installation de Node.js
    try {
        const nodeVersion = execSync('node -v').toString().trim();
        if (parseInt(nodeVersion.split('.')[0].replace('v', '')) < 16) {
            console.error('Node.js version 16 or later is required. Please install it and try again.');
            process.exit(1);
        }
    } catch (error) {
        console.error('Node.js is not installed. Please install Node.js 16 or later and try again.');
        process.exit(1);
    }

    // Configuration du registre NPM pour Pyrometer
    console.log('Configuring NPM registry for Pyrometer...');
    execSync('npm config set @tezos-kiln:registry https://gitlab.com/api/v4/packages/npm/');

    // Installation de Pyrometer
    console.log('Installing Pyrometer...');
    execSync('npm install -g @tezos-kiln/pyrometer');

    // Demander à l'utilisateur le répertoire de surveillance
    const { monitoringDir } = await inquirer.prompt([
        {
            type: 'input',
            name: 'monitoringDir',
            message: 'Enter the path where the monitoring directory should be created (default is /home/user/tezos-monitoring):',
            default: path.join(process.env.HOME, 'tezos-monitoring'),
        }
    ]);

    const configFilePath = path.join(monitoringDir, 'pyrometer.toml');
    const dataDirPath = path.join(monitoringDir, 'data');

    // Créer le répertoire de surveillance et les sous-répertoires s'ils n'existent pas
    if (!fs.existsSync(monitoringDir)) {
        fs.mkdirSync(monitoringDir, { recursive: true });
    }

    if (!fs.existsSync(dataDirPath)) {
        fs.mkdirSync(dataDirPath);
    }

    console.log('Creating Pyrometer configuration file...');

    const pyrometerConfig = `
data_dir = "${dataDirPath}"
exclude = [ "baked", "endorsed" ]

[baker_monitor]
bakers = [ "${bakerAddress}" ]
max_catchup_blocks = 120
head_distance = 2
missed_threshold = 5
rpc = "http://127.0.0.1:${rpcPort}"

[log]
level = "info"
timestamp = false

[node_monitor]
nodes = [ ]
teztnets = false
teztnets_config = "https://teztnets.xyz/teztnets.json"
low_peer_count = 5

[slack]
enabled = false
url = "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX"
emoji = true
short_address = true
exclude = [ ]

[telegram]
enabled = false
token = "1234567890:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
emoji = true
short_address = true
exclude = [ ]

[email]
enabled = false
host = "localhost"
port = 25
protocol = "PLAIN"
to = [ "me@example.org" ]
from = "pyrometer <me@example.org>"
username = ""
password = ""
emoji = true
short_address = true
exclude = [ ]

[desktop]
enabled = false
sound = false
emoji = true
short_address = true
exclude = [ ]

[webhook]
enabled = false
url = "http://192.168.1.10/mywebhook"
user_agent = "pyrometer/1.0.0"
test_endpoint_port = 0
exclude = [ ]
request_timeout = 30

[notifications]
interval = 60
max_batch_size = 100
ttl = 86_400

[ui]
enabled = true
host = "localhost"
port = 2_020
explorer_url = "https://tzkt.io"

[autodetect]
enabled = true

[rpc]
retry_attempts = 3
retry_interval_ms = 1_000
    `;

    fs.writeFileSync(configFilePath, pyrometerConfig);

    console.log(`Configuration file created at ${configFilePath}. Please edit this file as necessary.`);

    // Trouver l'emplacement du binaire pyrometer
    const pyrometerBinaryPath = execSync('which pyrometer').toString().trim();

    // Démarrer Pyrometer
    console.log('Starting Pyrometer...');
    execSync(`"${pyrometerBinaryPath}" run -c "${configFilePath}" -d "${dataDirPath}"`, { stdio: 'inherit' });

    console.log('Pyrometer has been started for monitoring the baker.');
}

// Fonction pour gérer les tâches post-setup du baker, y compris la configuration de Pyrometer
async function postBakerSetup() {
    // Récupérer l'adresse du baker et le port RPC à partir de la configuration en cours
    const alias = 'baker_key'; // Suppose that the alias is known or set earlier in the script
    const bakerAddress = showAddress(alias);

    // Récupérer les informations du processus du nœud pour extraire le port RPC
    const processInfo = execSync('ps aux | grep octez-node').toString().split('\n')[0];
    const { rpcPort } = parseNodeProcess(processInfo);

    const { enableMonitoring } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'enableMonitoring',
            message: 'Do you want to enable monitoring for the baker using Pyrometer?',
            default: true
        }
    ]);

    if (enableMonitoring) {
        await setupPyrometer(bakerAddress, rpcPort);
    }
}

module.exports = {
    postBakerSetup
};
