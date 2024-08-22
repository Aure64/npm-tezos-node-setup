const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');
const getOS = require('./getOS');
const downloadFile = require('./downloadFile');

const GITLAB_API_URL = 'https://gitlab.com';
const PROJECT_ID = 'tezos/tezos';

// Get installed version of a specific binary
function getInstalledVersion(binaryName) {
    try {
        const versionOutput = execSync(`${binaryName} --version`).toString().trim();
        const versionMatch = versionOutput.match(/(\d+\.\d+)/);
        if (versionMatch) {
            return versionMatch[0];
        }
    } catch (error) {
        // If the binary is not found or the version command fails, assume it's not installed
        return null;
    }
    return null;
}

// Get the latest binaries package information based on the OS and version
async function getLatestBinariesPackageInfo(distro) {
    try {
        const response = await axios.get(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(PROJECT_ID)}/packages`, {
            params: {
                order_by: 'created_at',
                sort: 'desc',
                per_page: 50
            }
        });

        // Find the package that matches the OS distro and version
        const binariesPackage = response.data.find(pkg =>
            pkg.name.includes(`octez-${distro}-`) &&
            !pkg.name.includes('beta') &&
            !pkg.name.includes('test')
        );

        if (!binariesPackage) {
            console.error(`[packageManager] No suitable binaries package found for distro: ${distro}`);
            return null;
        }

        console.log(`[packageManager] Found binaries package: ${binariesPackage.name}, version: ${binariesPackage.version}`);

        const packageFilesResponse = await axios.get(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(PROJECT_ID)}/packages/${binariesPackage.id}/package_files`);

        const packageFiles = {
            node: packageFilesResponse.data.find(file => file.file_name.includes('octez-node')),
            client: packageFilesResponse.data.find(file => file.file_name.includes('octez-client')),
            baker: packageFilesResponse.data.find(file => file.file_name.includes('octez-baker'))
        };

        if (!packageFiles.node || !packageFiles.client) {
            console.error(`[packageManager] Required package files not found in: ${binariesPackage.name}`);
            return null;
        }

        console.log(`[packageManager] Package files found: node=${packageFiles.node.file_name}, client=${packageFiles.client.file_name}`);

        return {
            version: binariesPackage.version,
            nodeUrl: `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.node.id}/download`,
            clientUrl: `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.client.id}/download`,
            bakerUrl: packageFiles.baker ? `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.baker.id}/download` : null
        };
    } catch (error) {
        console.error(`[packageManager] Error retrieving latest binaries package for distro: ${distro}`, error.message);
        return null;
    }
}

// Install dependencies using apt-get
async function installDependencies() {
    try {
        execSync('sudo apt-get install -f -y');
    } catch (error) {
        console.error('Error installing dependencies:', error.message);
        process.exit(1);
    }
}

// Install Tezos node and client
async function installTezosNode() {
    const { distro } = await getOS();

    const installedClientVersion = getInstalledVersion('octez-client');
    const installedNodeVersion = getInstalledVersion('octez-node');

    const binariesPackageInfo = await getLatestBinariesPackageInfo(distro);

    if (!binariesPackageInfo) {
        console.error('Unable to find binaries package URLs for the specified distro.');
        process.exit(1);
    }

    if (installedClientVersion === binariesPackageInfo.version && installedNodeVersion === binariesPackageInfo.version) {
        console.log('octez-client and octez-node are already up to date. No action needed.');
        return;
    } else {
        console.log(`Current version: client=${installedClientVersion}, node=${installedNodeVersion}`);
        console.log(`Latest version: ${binariesPackageInfo.version}`);
    }

    const tmpClientPath = '/tmp/octez-client.deb';
    const tmpNodePath = '/tmp/octez-node.deb';

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

// Install Tezos baker
async function installTezosBaker(protocolHash) {
    const { distro } = await getOS();

    const binariesPackageInfo = await getLatestBinariesPackageInfo(distro);

    if (!binariesPackageInfo || !binariesPackageInfo.bakerUrl) {
        console.error('No baker binaries package info retrieved.');
        process.exit(1);
    }

    const tmpBakerPath = '/tmp/octez-baker.deb';

    try {
        console.log('Downloading octez-baker...');
        await downloadFile(binariesPackageInfo.bakerUrl, tmpBakerPath);
        await installPackageOrBinary(tmpBakerPath, 'octez-baker');
        console.log('octez-baker installed/updated successfully.');
    } finally {
        if (fs.existsSync(tmpBakerPath)) {
            fs.unlinkSync(tmpBakerPath);
        }
    }
}

// Install a .deb package or move an ELF binary to /usr/bin
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

module.exports = {
    getLatestBinariesPackageInfo,
    downloadFile,
    installTezosNode,
    installTezosBaker,
    installPackageOrBinary
};
