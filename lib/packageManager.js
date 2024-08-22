const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');
const getOS = require('./getOS');
const downloadFile = require('./downloadFile');

const GITLAB_API_URL = 'https://gitlab.com';
const PROJECT_ID = 'tezos/tezos';

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
                per_page: 50
            }
        });

        // Filter packages that match the detected distro
        const distroPackages = response.data.filter(pkg =>
            pkg.name.includes(distro) &&
            !pkg.name.includes('beta') &&
            !pkg.name.includes('test')
        );

        if (distroPackages.length === 0) {
            return null;
        }

        // Sort packages by version (latest first) and pick the latest one
        const latestPackage = distroPackages.sort((a, b) => {
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

    const binariesPackageInfo = await getLatestBinariesPackageInfo(distro);

    if (!binariesPackageInfo) {
        console.error('Unable to find binaries package URLs for the specified distro.');
        process.exit(1);
    }

    if (installedClientVersion === binariesPackageInfo.version && installedNodeVersion === binariesPackageInfo.version) {
        return;
    }

    const tmpClientPath = '/tmp/octez-client.deb';
    const tmpNodePath = '/tmp/octez-node.deb';

    try {
        if (installedClientVersion !== binariesPackageInfo.version) {
            await downloadFile(binariesPackageInfo.clientUrl, tmpClientPath);
            await installPackageOrBinary(tmpClientPath, 'octez-client');
        }

        if (installedNodeVersion !== binariesPackageInfo.version) {
            await downloadFile(binariesPackageInfo.nodeUrl, tmpNodePath);
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
    installPackageOrBinary
};
