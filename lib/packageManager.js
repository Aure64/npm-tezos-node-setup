const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');
const getOS = require('./getOS');
const downloadFile = require('./downloadFile');

const GITLAB_API_URL = 'https://gitlab.com';
const PROJECT_ID = 'tezos/tezos';

// Function to determine the architecture of the system
function getArchitecture() {
    const arch = execSync('uname -m').toString().trim();
    if (arch === 'x86_64' || arch === 'amd64') {
        return 'x86_64';
    } else if (arch.startsWith('arm')) {
        return 'arm64';
    } else {
        throw new Error(`Unsupported architecture: ${arch}`);
    }
}

// Function to get the installed version of a binary (e.g., octez-client, octez-node)
function getInstalledVersion(binaryName) {
    try {
        const versionOutput = execSync(`${binaryName} --version`).toString().trim();
        const versionMatch = versionOutput.match(/(\d+\.\d+)/); // Assuming version is in the form "20.2"
        if (versionMatch) {
            return versionMatch[0];
        }
    } catch (error) {
        // If the binary is not found or the version command fails, assume it's not installed
        return null;
    }
    return null;
}

// Function to retrieve the latest binaries package information from GitLab
async function getLatestBinariesPackageInfo(arch) {
    try {
        const response = await axios.get(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(PROJECT_ID)}/packages`, {
            params: {
                order_by: 'created_at',
                sort: 'desc',
                per_page: 20
            }
        });


        const binariesPackage = response.data.find(pkg =>
            pkg.name.includes('octez-binaries') &&
            !pkg.name.toLowerCase().includes('beta') &&
            !pkg.name.toLowerCase().includes('test')
        );

        if (!binariesPackage) {
            console.error(`No binaries package found for architecture ${arch}`);
            return null;
        }

        const packageFilesResponse = await axios.get(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(PROJECT_ID)}/packages/${binariesPackage.id}/package_files`);

        const bakerFiles = packageFilesResponse.data.filter(file => file.file_name.includes(`${arch}-octez-baker`));

        const packageFiles = {
            node: packageFilesResponse.data.find(file => file.file_name.includes(`${arch}-octez-node`)),
            client: packageFilesResponse.data.find(file => file.file_name.includes(`${arch}-octez-client`)),
            baker: bakerFiles,
            files: packageFilesResponse.data
        };

        if (!packageFiles.node || !packageFiles.client) {
            console.error(`Required package files not found for architecture ${arch}`);
            return null;
        }

        return {
            version: binariesPackage.version,
            nodeUrl: `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.node.id}/download`,
            clientUrl: `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.client.id}/download`,
            bakerFiles: bakerFiles,
            files: packageFilesResponse.data
        };
    } catch (error) {
        console.error(`Error retrieving latest binaries package URL for architecture ${arch}:`, error.message);
        return null;
    }
}



// Function to install necessary dependencies
async function installDependencies() {
    try {
        execSync('sudo apt-get install -f -y');
    } catch (error) {
        console.error('Error installing dependencies:', error.message);
        process.exit(1);
    }
}

// Function to install the Tezos node
async function installTezosNode() {
    const { distro } = await getOS();
    const arch = getArchitecture();

    const installedClientVersion = getInstalledVersion('octez-client');
    const installedNodeVersion = getInstalledVersion('octez-node');

    const binariesPackageInfo = await getLatestBinariesPackageInfo(arch);

    if (!binariesPackageInfo) {
        console.error('Unable to find binaries package URLs for the specified architecture.');
        process.exit(1);
    }

    if (installedClientVersion === binariesPackageInfo.version && installedNodeVersion === binariesPackageInfo.version) {
        console.log('octez-client and octez-node are already up to date. No action needed.');
        return;
    } else {
        console.log(`Current version: client=${installedClientVersion}, node=${installedNodeVersion}`);
        console.log(`Latest version: ${binariesPackageInfo.version}`);
    }

    const tmpClientPath = '/tmp/octez-client';
    const tmpNodePath = '/tmp/octez-node';

    try {
        if (installedClientVersion !== binariesPackageInfo.version) {
            console.log('Downloading octez-client...');
            await downloadFile(binariesPackageInfo.clientUrl, tmpClientPath);
            await installPackageOrBinary(tmpClientPath, 'octez-client');
        }

        if (installedNodeVersion !== binariesPackageInfo.version) {
            console.log('Downloading octez-node...');
            await downloadFile(binariesPackageInfo.nodeUrl, tmpNodePath);
            await installPackageOrBinary(tmpNodePath, 'octez-node');
        }

        console.log('octez-client and octez-node installed/updated successfully.');
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
    const arch = getArchitecture();

    // Get the latest binary package info
    const binariesPackageInfo = await getLatestBinariesPackageInfo(arch);

    if (!binariesPackageInfo) {
        console.error('No binaries package info retrieved.');
        process.exit(1);
    }

    if (!binariesPackageInfo.files || binariesPackageInfo.files.length === 0) {
        console.error('No files found in the binaries package info.');
        process.exit(1);
    }

    // Find the baker file that matches the beginning of the protocolHash
    const bakerFile = binariesPackageInfo.files.find(file =>
        file.file_name.includes(`${arch}-octez-baker-`) &&
        protocolHash.startsWith(file.file_name.split('-').pop())
    );

    if (!bakerFile) {
        console.error(`Baker binary not found for protocol ${protocolHash} and architecture ${arch}`);
        process.exit(1);
    }

    const bakerBinaryName = bakerFile.file_name.split('-').pop();
    const installedBakerVersion = getInstalledVersion(`octez-baker-${bakerBinaryName}`);

    if (installedBakerVersion === binariesPackageInfo.version) {
        console.log(`octez-baker-${bakerBinaryName} is already up to date. No action needed.`);
        return;
    }

    const tmpBakerPath = `/tmp/octez-baker-${bakerBinaryName}`;

    try {
        console.log(`Downloading octez-baker-${bakerBinaryName}...`);
        await downloadFile(`${GITLAB_API_URL}/tezos/tezos/-/package_files/${bakerFile.id}/download`, tmpBakerPath);
        await installPackageOrBinary(tmpBakerPath, `octez-baker-${bakerBinaryName}`);
        console.log(`octez-baker-${bakerBinaryName} installed/updated successfully.`);
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
            execSync(`sudo dpkg -i ${filePath}`);
        } catch (error) {
            console.error(`Error installing ${binaryName}, attempting to fix dependencies...`);
            await installDependencies();
            execSync(`sudo dpkg -i ${filePath}`);
        }
    } else if (fileType.includes('ELF')) {
        const destinationPath = `/usr/bin/${binaryName}`;
        execSync(`sudo mv ${filePath} ${destinationPath}`);
        execSync(`sudo chmod +x ${destinationPath}`);
        console.log(`${binaryName} installed successfully to ${destinationPath}.`);
    } else {
        console.error(`Unsupported file type for ${binaryName}: ${fileType}`);
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
