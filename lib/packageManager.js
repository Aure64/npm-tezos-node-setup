const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');
const getOS = require('./getOS');
const downloadFile = require('./downloadFile');

const GITLAB_API_URL = 'https://gitlab.com';
const PROJECT_ID = 'tezos/tezos';

function log(message) {
    console.log(`[packageManager] ${message}`);
}

function getInstalledVersion(binaryName) {
    try {
        const versionOutput = execSync(`${binaryName} --version`).toString().trim();
        const versionMatch = versionOutput.match(/(\d+\.\d+)/); // Assuming version is in the form "20.2"
        if (versionMatch) {
            return versionMatch[0];
        }
    } catch (error) {
        log(`Failed to get version for ${binaryName}: ${error.message}`);
        return null;
    }
    return null;
}

async function getLatestBinariesPackageInfo() {
    try {
        log(`Fetching latest binaries packages from ${GITLAB_API_URL}`);
        const response = await axios.get(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(PROJECT_ID)}/packages`, {
            params: {
                order_by: 'created_at',
                sort: 'desc',
                per_page: 20
            }
        });


        const binariesPackage = response.data.find(pkg =>
            pkg.name.includes('octez-binaries') &&
            !pkg.name.includes('beta') &&
            !pkg.name.includes('test')
        );

        if (!binariesPackage) {
            log('No suitable binaries package found.');
            return null;
        }

        log(`Found binaries package: ${binariesPackage.name}, version: ${binariesPackage.version}`);

        const packageFilesResponse = await axios.get(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(PROJECT_ID)}/packages/${binariesPackage.id}/package_files`);

        const packageFiles = {
            node: packageFilesResponse.data.find(file => file.file_name.includes('octez-node')),
            client: packageFilesResponse.data.find(file => file.file_name.includes('octez-client')),
            baker: packageFilesResponse.data.filter(file => file.file_name.includes('octez-baker')),
            files: packageFilesResponse.data
        };

        if (!packageFiles.node || !packageFiles.client) {
            log('Required package files (node or client) not found.');
            return null;
        }

        log(`Package files found: node=${packageFiles.node.file_name}, client=${packageFiles.client.file_name}`);

        return {
            version: binariesPackage.version,
            nodeUrl: `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.node.id}/download`,
            clientUrl: `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.client.id}/download`,
            bakerFiles: packageFiles.baker,
            files: packageFilesResponse.data
        };
    } catch (error) {
        log(`Error retrieving latest binaries package URL: ${error.message}`);
        return null;
    }
}



// Function to install necessary dependencies
async function installDependencies() {
    try {
        log('Installing missing dependencies...');
        execSync('sudo apt-get install -f -y');
    } catch (error) {
        log(`Error installing dependencies: ${error.message}`);
        process.exit(1);
    }
}

// Function to install the Tezos node
async function installTezosNode() {
    const { distro } = await getOS();

    const installedClientVersion = getInstalledVersion('octez-client');
    const installedNodeVersion = getInstalledVersion('octez-node');

    const binariesPackageInfo = await getLatestBinariesPackageInfo();

    if (!binariesPackageInfo) {
        log('Unable to find binaries package URLs.');
        process.exit(1);
    }

    if (installedClientVersion === binariesPackageInfo.version && installedNodeVersion === binariesPackageInfo.version) {
        log('octez-client and octez-node are already up to date. No action needed.');
        return;
    } else {
        log(`Current version: client=${installedClientVersion}, node=${installedNodeVersion}`);
        log(`Latest version: ${binariesPackageInfo.version}`);
    }

    const tmpClientPath = '/tmp/octez-client';
    const tmpNodePath = '/tmp/octez-node';

    try {
        if (installedClientVersion !== binariesPackageInfo.version) {
            log('Downloading octez-client...');
            await downloadFile(binariesPackageInfo.clientUrl, tmpClientPath);
            await installPackageOrBinary(tmpClientPath, 'octez-client');
        }

        if (installedNodeVersion !== binariesPackageInfo.version) {
            log('Downloading octez-node...');
            await downloadFile(binariesPackageInfo.nodeUrl, tmpNodePath);
            await installPackageOrBinary(tmpNodePath, 'octez-node');
        }

        log('octez-client and octez-node installed/updated successfully.');
    } finally {
        if (fs.existsSync(tmpClientPath)) {
            fs.unlinkSync(tmpClientPath);
        }
        if (fs.existsSync(tmpNodePath)) {
            fs.unlinkSync(tmpNodePath);
        }
    }
}

// Function to install the Tezos baker
async function installTezosBaker(protocolHash) {
    const binariesPackageInfo = await getLatestBinariesPackageInfo();

    if (!binariesPackageInfo) {
        log('No binaries package info retrieved.');
        process.exit(1);
    }

    if (!binariesPackageInfo.files || binariesPackageInfo.files.length === 0) {
        log('No files found in the binaries package info.');
        process.exit(1);
    }

    // Find the baker file that matches the beginning of the protocolHash
    const bakerFile = binariesPackageInfo.files.find(file =>
        file.file_name.includes('octez-baker-') &&
        protocolHash.startsWith(file.file_name.split('-').pop())
    );

    if (!bakerFile) {
        log(`Baker binary not found for protocol ${protocolHash}`);
        process.exit(1);
    }

    const bakerBinaryName = bakerFile.file_name.split('-').pop();
    const installedBakerVersion = getInstalledVersion(`octez-baker-${bakerBinaryName}`);

    if (installedBakerVersion === binariesPackageInfo.version) {
        log(`octez-baker-${bakerBinaryName} is already up to date. No action needed.`);
        return;
    }

    const tmpBakerPath = `/tmp/octez-baker-${bakerBinaryName}`;

    try {
        log(`Downloading octez-baker-${bakerBinaryName}...`);
        await downloadFile(`${GITLAB_API_URL}/tezos/tezos/-/package_files/${bakerFile.id}/download`, tmpBakerPath);
        await installPackageOrBinary(tmpBakerPath, `octez-baker-${bakerBinaryName}`);
        log(`octez-baker-${bakerBinaryName} installed/updated successfully.`);
    } finally {
        if (fs.existsSync(tmpBakerPath)) {
            fs.unlinkSync(tmpBakerPath);
        }
    }
}

// Function to install a package or binary, depending on the file type
async function installPackageOrBinary(filePath, binaryName) {
    const fileType = execSync(`file -b ${filePath}`).toString().trim();

    if (fileType.includes('Debian binary package')) {
        try {
            log(`Installing Debian package: ${binaryName}`);
            execSync(`sudo dpkg -i ${filePath}`);
        } catch (error) {
            log(`Error installing ${binaryName}, attempting to fix dependencies...`);
            await installDependencies();
            execSync(`sudo dpkg -i ${filePath}`);
        }
    } else if (fileType.includes('ELF')) {
        const destinationPath = `/usr/bin/${binaryName}`;
        execSync(`sudo mv ${filePath} ${destinationPath}`);
        execSync(`sudo chmod +x ${destinationPath}`);
        log(`${binaryName} installed successfully to ${destinationPath}.`);
    } else {
        log(`Unsupported file type for ${binaryName}: ${fileType}`);
        throw new Error(`Unsupported file type for ${binaryName}`);
    }
}

// Export the functions for external use
module.exports = {
    getLatestBinariesPackageInfo,
    downloadFile,
    installTezosNode,
    installTezosBaker,
    installPackageOrBinary
};
