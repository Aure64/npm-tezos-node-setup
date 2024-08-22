const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');
const getOS = require('./getOS');
const downloadFile = require('./downloadFile');

const GITLAB_API_URL = 'https://gitlab.com';
const PROJECT_ID = 'tezos/tezos';

// Function to get the installed version of a Tezos binary (e.g., octez-client or octez-node)
function getInstalledVersion(binaryName) {
    try {
        const versionOutput = execSync(`${binaryName} --version`).toString().trim();
        const versionMatch = versionOutput.match(/(\d+\.\d+)/);
        if (versionMatch) {
            return versionMatch[0];
        }
    } catch (error) {
        // Return null if the binary is not found or the version command fails
        return null;
    }
    return null;
}

// Function to fetch the latest Tezos binary package info from GitLab for the detected OS distribution
async function getLatestBinariesPackageInfo(distro) {
    try {
        const response = await axios.get(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(PROJECT_ID)}/packages`, {
            params: {
                order_by: 'created_at',
                sort: 'desc',
                per_page: 50
            }
        });

        // Find the relevant package for the specific distribution and version
        const binariesPackage = response.data.find(pkg =>
            pkg.name.includes(`octez-debian-${distro}-20.2`) &&
            !pkg.name.includes('beta') &&
            !pkg.name.includes('test')
        );

        if (!binariesPackage) {
            return null;
        }

        // Fetch the files associated with the selected package
        const packageFilesResponse = await axios.get(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(PROJECT_ID)}/packages/${binariesPackage.id}/package_files`);

        // Extract URLs for the required binaries: node, client, and baker
        const packageFiles = {
            node: packageFilesResponse.data.find(file => file.file_name.includes('octez-node')),
            client: packageFilesResponse.data.find(file => file.file_name.includes('octez-client')),
            baker: packageFilesResponse.data.find(file => file.file_name.includes('octez-baker'))
        };

        if (!packageFiles.node || !packageFiles.client) {
            return null;
        }

        return {
            version: binariesPackage.version,
            nodeUrl: `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.node.id}/download`,
            clientUrl: `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.client.id}/download`,
            bakerUrl: packageFiles.baker ? `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.baker.id}/download` : null
        };
    } catch (error) {
        console.error(`Error retrieving latest binaries package for distro: ${distro}`, error.message);
        return null;
    }
}

// Function to install missing dependencies
async function installDependencies() {
    try {
        execSync('sudo apt-get install -f -y');
    } catch (error) {
        console.error('Error installing dependencies:', error.message);
        process.exit(1);
    }
}

// Function to install or update the Tezos node (octez-node and octez-client)
async function installTezosNode() {
    const { distro } = await getOS();

    // Check currently installed versions of octez-client and octez-node
    const installedClientVersion = getInstalledVersion('octez-client');
    const installedNodeVersion = getInstalledVersion('octez-node');

    // Get the latest available binary package info for the detected OS distribution
    const binariesPackageInfo = await getLatestBinariesPackageInfo(distro);

    if (!binariesPackageInfo) {
        console.error('Unable to find binaries package URLs for the specified distro.');
        process.exit(1);
    }

    // Compare installed versions with the latest available versions
    if (installedClientVersion === binariesPackageInfo.version && installedNodeVersion === binariesPackageInfo.version) {
        console.log('octez-client and octez-node are already up to date. No action needed.');
        return;
    }

    const tmpClientPath = '/tmp/octez-client.deb';
    const tmpNodePath = '/tmp/octez-node.deb';

    try {
        // Download and install the octez-client binary if the installed version is outdated or missing
        if (installedClientVersion !== binariesPackageInfo.version) {
            console.log('Downloading and installing the latest octez-client...');
            await downloadFile(binariesPackageInfo.clientUrl, tmpClientPath);
            await installPackageOrBinary(tmpClientPath, 'octez-client');
        }

        // Download and install the octez-node binary if the installed version is outdated or missing
        if (installedNodeVersion !== binariesPackageInfo.version) {
            console.log('Downloading and installing the latest octez-node...');
            await downloadFile(binariesPackageInfo.nodeUrl, tmpNodePath);
            await installPackageOrBinary(tmpNodePath, 'octez-node');
        }

        console.log('octez-client and octez-node installed/updated successfully.');
    } finally {
        // Clean up temporary files
        if (fs.existsSync(tmpClientPath)) {
            fs.unlinkSync(tmpClientPath);
        }
        if (fs.existsSync(tmpNodePath)) {
            fs.unlinkSync(tmpNodePath);
        }
    }
}

// Function to install the Tezos baker binary
async function installTezosBaker(protocolHash) {
    const { distro } = await getOS();

    // Get the latest available baker binary package info for the detected OS distribution
    const binariesPackageInfo = await getLatestBinariesPackageInfo(distro);

    if (!binariesPackageInfo || !binariesPackageInfo.bakerUrl) {
        console.error('No baker binaries package info retrieved.');
        process.exit(1);
    }

    const tmpBakerPath = '/tmp/octez-baker.deb';

    try {
        // Download and install the octez-baker binary
        console.log('Downloading and installing the latest octez-baker...');
        await downloadFile(binariesPackageInfo.bakerUrl, tmpBakerPath);
        await installPackageOrBinary(tmpBakerPath, 'octez-baker');
        console.log('octez-baker installed/updated successfully.');
    } finally {
        // Clean up temporary files
        if (fs.existsSync(tmpBakerPath)) {
            fs.unlinkSync(tmpBakerPath);
        }
    }
}

// Function to install a package or binary from a given file path
async function installPackageOrBinary(filePath, binaryName) {
    const fileType = execSync(`file -b ${filePath}`).toString().trim();

    if (fileType.includes('Debian binary package')) {
        try {
            // Install the .deb package using dpkg
            execSync(`sudo dpkg -i ${filePath}`);
        } catch (error) {
            // Attempt to fix missing dependencies and retry installation
            await installDependencies();
            execSync(`sudo dpkg -i ${filePath}`);
        }
    } else if (fileType.includes('ELF')) {
        // For ELF files, move the binary to /usr/bin and make it executable
        const destinationPath = `/usr/bin/${binaryName}`;
        execSync(`sudo mv ${filePath} ${destinationPath}`);
        execSync(`sudo chmod +x ${destinationPath}`);
        console.log(`${binaryName} installed successfully to ${destinationPath}.`);
    } else {
        // Handle unsupported file types
        console.error(`Unsupported file type for ${binaryName}: ${fileType}`);
        throw new Error(`Unsupported file type for ${binaryName}`);
    }
}

// Export functions for external use
module.exports = {
    getLatestBinariesPackageInfo,
    downloadFile,
    installTezosNode,
    installTezosBaker,
    installPackageOrBinary
};
