const { execSync } = require('child_process');
const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const { tzAddress } = require('./bakerManager'); // Assume tzAddress is correctly initialized in bakerManager
const { parseNodeProcess } = require('./nodeManager');
const { configurePyrometerService } = require('./serviceManager'); // Import for setting up the monitoring service

async function isPyrometerInstalled() {
    try {
        const version = execSync('pyrometer --version').toString().trim();
        console.log(`Pyrometer version found: ${version}`);
        return version.includes('v1.0.0'); // Replace with the current Pyrometer version
    } catch (error) {
        console.error('Pyrometer is not installed or failed to detect the version.');
        return false;
    }
}

async function setupPyrometer(bakerAddress, rpcPort) {
    console.log('Setting up Pyrometer for monitoring the baker...');
    console.log(`Baker Address in setupPyrometer: ${bakerAddress}`);
    console.log(`RPC Port in setupPyrometer: ${rpcPort}`);

    // Verify if Node.js is installed
    try {
        const nodeVersion = execSync('node -v').toString().trim();
        console.log(`Node.js version: ${nodeVersion}`);
        if (parseInt(nodeVersion.split('.')[0].replace('v', '')) < 16) {
            console.error('Node.js version 16 or later is required. Please install it and try again.');
            process.exit(1);
        }
    } catch (error) {
        console.error('Node.js is not installed. Please install Node.js 16 or later and try again.');
        process.exit(1);
    }

    // Check if Pyrometer is already installed
    const pyrometerInstalled = await isPyrometerInstalled();
    if (pyrometerInstalled) {
        console.log('Pyrometer is already installed and up-to-date.');
    } else {
        // Configure the NPM registry for Pyrometer
        console.log('Configuring NPM registry for Pyrometer...');
        execSync('npm config set @tezos-kiln:registry https://gitlab.com/api/v4/packages/npm/');

        // Install Pyrometer
        console.log('Installing Pyrometer...');
        execSync('npm install -g @tezos-kiln/pyrometer');
    }

    // Prompt the user for the monitoring directory
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

    // Create the monitoring directory and subdirectories if they do not exist
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

    // Start the Pyrometer service
    console.log('Configuring and starting the Pyrometer service...');
    await configurePyrometerService(monitoringDir);

    console.log('Pyrometer service has been configured and started successfully.');
}

async function postBakerSetup(tzAddress) {
    console.log(`Using tzAddress in postBakerSetup: ${tzAddress}`);

    const bakerAddress = tzAddress;

    // Retrieve all running octez-node processes
    const processOutput = execSync('ps aux | grep octez-node').toString().split('\n');
    const runningNodes = processOutput
        .filter(line => line.includes('--rpc-addr'))
        .map(line => {
            const match = line.match(/--rpc-addr\s+127\.0\.0\.1:(\d+)/);
            return match ? match[1] : null;
        })
        .filter(port => port !== null);

    if (runningNodes.length === 0) {
        console.error('No running Tezos nodes found.');
        return;
    }

    const { chosenRpcPort } = await inquirer.prompt([
        {
            type: 'list',
            name: 'chosenRpcPort',
            message: 'Select the RPC port of the Tezos node you want to monitor:',
            choices: runningNodes
        }
    ]);

    console.log(`Selected RPC port: ${chosenRpcPort}`);

    const { enableMonitoring } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'enableMonitoring',
            message: 'Do you want to enable monitoring for the baker using Pyrometer?',
            default: true
        }
    ]);

    if (enableMonitoring) {
        await setupPyrometer(bakerAddress, chosenRpcPort);
    }
}


module.exports = {
    postBakerSetup
};
