const { execSync } = require('child_process');
const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');

async function setupPyrometer() {
    console.log('Setting up Pyrometer for monitoring the baker...');

    // Check if Node.js is installed and version is 16 or later
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

    // Configure NPM registry for Pyrometer
    console.log('Configuring NPM registry for Pyrometer...');
    execSync('npm config set @tezos-kiln:registry https://gitlab.com/api/v4/packages/npm/');

    // Install Pyrometer globally
    console.log('Installing Pyrometer...');
    execSync('npm install -g @tezos-kiln/pyrometer');

    // Generate a sample configuration file
    const configFilePath = path.join(process.cwd(), 'pyrometer.toml');
    const dataDirPath = path.join(process.cwd(), 'data');

    console.log('Creating Pyrometer configuration file...');
    execSync(`pyrometer config sample > ${configFilePath}`);

    console.log(`Configuration file created at ${configFilePath}. Please edit this file as necessary.`);

    // Ensure the data directory exists
    if (!fs.existsSync(dataDirPath)) {
        fs.mkdirSync(dataDirPath);
    }

    // Start Pyrometer
    console.log('Starting Pyrometer...');
    execSync(`pyrometer run -c ${configFilePath} -d ${dataDirPath}`, { stdio: 'inherit' });

    console.log('Pyrometer has been started for monitoring the baker.');
}

// Function to handle post-baker setup tasks including Pyrometer setup
async function postBakerSetup() {
    const { enableMonitoring } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'enableMonitoring',
            message: 'Do you want to enable monitoring for the baker using Pyrometer?',
            default: true
        }
    ]);

    if (enableMonitoring) {
        await setupPyrometer();
    }
}

module.exports = {
    postBakerSetup
};
