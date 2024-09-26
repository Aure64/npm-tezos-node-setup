const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const getOS = require('./getOS');
const downloadFile = require('./downloadFile');

const GITLAB_API_URL = 'https://gitlab.com';
const PROJECT_ID = 'tezos/tezos';

// Function to download and install Zcash parameters
async function installZcashParams() {
    const zcashDirs = [
        '/usr/share/zcash-params',
        '/usr/local/share/zcash-params',
        '/_opam/share/zcash-params'
    ];

    // Check if the Zcash parameters already exist in any of the specified directories
    const paramsExist = zcashDirs.some(dir => fs.existsSync(dir) && fs.readdirSync(dir).length > 0);

    if (!paramsExist) {
        console.log('Zcash parameters not found. Downloading and installing...');

        const fetchParamsUrl = 'https://raw.githubusercontent.com/zcash/zcash/713fc761dd9cf4c9087c37b078bdeab98697bad2/zcutil/fetch-params.sh';
        const fetchParamsPath = '/tmp/fetch-params.sh';

        // Download the fetch-params.sh script
        await downloadFile(fetchParamsUrl, fetchParamsPath);

        // Make the script executable
        execSync(`chmod +x ${fetchParamsPath}`);

        try {
            // Run the script to install Zcash parameters into ~/.zcash-params
            execSync(fetchParamsPath, { stdio: 'inherit' });

            // Create the preferred directory if it doesn't exist
            const zcashDir = '/usr/share/zcash-params';
            execSync(`sudo mkdir -p ${zcashDir}`);

            // Move the downloaded parameters to the preferred directory
            execSync(`sudo mv ~/.zcash-params/* ${zcashDir}/`);
            console.log(`Zcash parameters moved to ${zcashDir}.`);

            // Clean up the original directory
            execSync(`rm -rf ~/.zcash-params`);
            console.log('Original Zcash parameters directory removed.');

        } catch (error) {
            console.error(`Error installing Zcash parameters: ${error.message}`);
            process.exit(1); // Exit if installation fails
        }
    } else {
        console.log('Zcash parameters are already installed.');
    }
}


// Function to get the installed version of a binary
function getInstalledVersion(binaryName) {
    try {
        const versionOutput = execSync(`${binaryName} --version`).toString().trim();
        const versionMatch = versionOutput.match(/(\d+\.\d+)/);
        if (versionMatch) {
            return versionMatch[0];
        }
    } catch (error) {
        return null;
    }
    return null;
}

// Function to fetch the latest binaries package info for a given distro
async function getLatestBinariesPackageInfo(distro) {
    try {
        const response = await axios.get(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(PROJECT_ID)}/packages`, {
            params: {
                order_by: 'created_at',
                sort: 'desc',
                per_page: 250
            }
        });

        const stablePackages = response.data.filter(pkg =>
            pkg.name.includes(distro) &&
            !pkg.name.includes('beta') &&
            !pkg.name.includes('test') &&
            pkg.version.match(/^\d+\.\d+(\.\d+)?$/) // Match only stable versions
        );

        if (stablePackages.length === 0) {
            return null;
        }

        const latestPackage = stablePackages.sort((a, b) => {
            const versionA = parseFloat(a.version);
            const versionB = parseFloat(b.version);
            return versionB - versionA;
        })[0];

        const packageFilesResponse = await axios.get(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(PROJECT_ID)}/packages/${latestPackage.id}/package_files`);

        const packageFiles = {
            node: packageFilesResponse.data.find(file => file.file_name.includes('octez-node')),
            client: packageFilesResponse.data.find(file => file.file_name.includes('octez-client')),
            baker: packageFilesResponse.data.find(file => file.file_name.includes('octez-baker'))
        };

        if (!packageFiles.node || !packageFiles.client) {
            return null;
        }

        return {
            version: latestPackage.version,
            nodeUrl: `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.node.id}/download`,
            clientUrl: `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.client.id}/download`,
            bakerUrl: packageFiles.baker ? `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.baker.id}/download` : null
        };
    } catch (error) {
        console.error(`Error fetching the latest binaries package info: ${error.message}`);
        return null;
    }
}


// Function to install dependencies
async function installDependencies() {
    try {
        execSync('sudo apt-get install -f -y');
    } catch (error) {
        console.error('Error installing dependencies:', error.message);
        process.exit(1);
    }
}

// Function to install or update Tezos Node
async function installTezosNode() {
    const { distro } = await getOS();

    const installedClientVersion = getInstalledVersion('octez-client');
    const installedNodeVersion = getInstalledVersion('octez-node');

    console.log(`Current installed version of octez-client: ${installedClientVersion || 'Not installed'}`);
    console.log(`Current installed version of octez-node: ${installedNodeVersion || 'Not installed'}`);

    const binariesPackageInfo = await getLatestBinariesPackageInfo(distro);

    if (!binariesPackageInfo) {
        console.error('Unable to find binaries package URLs for the specified distro.');
        process.exit(1);
    }

    console.log(`Latest version available: ${binariesPackageInfo.version}`);

    if (installedClientVersion === binariesPackageInfo.version && installedNodeVersion === binariesPackageInfo.version) {
        console.log('The installed versions are up to date. No download needed.');
        return;
    }

    const tmpClientPath = '/tmp/octez-client.deb';
    const tmpNodePath = '/tmp/octez-node.deb';

    try {
        if (installedClientVersion !== binariesPackageInfo.version) {
            console.log(`Downloading octez-client from ${binariesPackageInfo.clientUrl}...`);
            await downloadFile(binariesPackageInfo.clientUrl, tmpClientPath);
            console.log(`Downloaded octez-client to ${tmpClientPath}`);
            await installPackageOrBinary(tmpClientPath, 'octez-client');
        }

        if (installedNodeVersion !== binariesPackageInfo.version) {
            console.log(`Downloading octez-node from ${binariesPackageInfo.nodeUrl}...`);
            await downloadFile(binariesPackageInfo.nodeUrl, tmpNodePath);
            console.log(`Downloaded octez-node to ${tmpNodePath}`);
            await installPackageOrBinary(tmpNodePath, 'octez-node');
        }
    } finally {
        if (fs.existsSync(tmpClientPath)) {
            fs.unlinkSync(tmpClientPath);
        }
        if (fs.existsSync(tmpNodePath)) {
            fs.unlinkSync(tmpNodePath);
        }
    }
}


// Function to install or update Tezos Baker

async function installTezosBaker(protocolHash) {
    const { distro } = await getOS();

    // Attempt to find the correct baker binary based on the protocol hash
    const bakerBinaries = execSync('ls /usr/bin/octez-baker-*').toString().split('\n');
    const protocolPrefix = protocolHash.slice(0, 8);
    const matchedBakerBinary = bakerBinaries.find(binary => binary.includes(protocolPrefix));

    if (matchedBakerBinary) {
        console.log(`Found existing baker binary: ${matchedBakerBinary}`);
        return; // No need to download, binary exists
    }

    // If no matching binary is found, proceed with download
    console.log(`No matching baker binary found for protocol ${protocolHash}. Downloading...`);

    const binariesPackageInfo = await getLatestBinariesPackageInfo(distro);

    if (!binariesPackageInfo || !binariesPackageInfo.bakerUrl) {
        console.error('No baker binaries package info retrieved.');
        process.exit(1);
    }

    const tmpBakerPath = '/tmp/octez-baker.deb';

    try {
        await downloadFile(binariesPackageInfo.bakerUrl, tmpBakerPath);
        await installPackageOrBinary(tmpBakerPath, 'octez-baker');
    } finally {
        if (fs.existsSync(tmpBakerPath)) {
            fs.unlinkSync(tmpBakerPath);
        }
    }
}
// Function to install a package or binary
async function installPackageOrBinary(filePath, binaryName) {
    const fileType = execSync(`file -b ${filePath}`).toString().trim();

    if (fileType.includes('Debian binary package')) {
        try {
            execSync(`sudo dpkg -i ${filePath}`);
        } catch (error) {
            await installDependencies();
            execSync(`sudo dpkg -i ${filePath}`);
        }
    } else if (fileType.includes('ELF')) {
        const destinationPath = `/usr/bin/${binaryName}`;
        execSync(`sudo mv ${filePath} ${destinationPath}`);
        execSync(`sudo chmod +x ${destinationPath}`);
    } else {
        throw new Error(`Unsupported file type for ${binaryName}`);
    }
}

module.exports = {
    getLatestBinariesPackageInfo,
    downloadFile,
    installTezosNode,
    installTezosBaker,
    installPackageOrBinary,
    installZcashParams
};
