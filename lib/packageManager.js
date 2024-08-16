const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');
const getOS = require('./getOS');
const downloadFile = require('./downloadFile');
const isPackageInstalled = require('./isPackageInstalled');

const GITLAB_API_URL = 'https://gitlab.com/api/v4/projects';
const PROJECT_ID = encodeURIComponent('tezos/tezos');

function getArchitecture() {
    const arch = execSync('uname -m').toString().trim();
    console.log(`Detected architecture: ${arch}`);
    if (arch === 'x86_64' || arch === 'amd64') {
        console.log('Architecture is x86_64');
        return 'x86_64';
    } else if (arch.startsWith('arm')) {
        console.log('Architecture is arm64');
        return 'arm64';
    } else {
        throw new Error(`Unsupported architecture: ${arch}`);
    }
}

async function getLatestBinariesPackageInfo(arch) {
    try {
        const response = await axios.get(`${GITLAB_API_URL}/${PROJECT_ID}/packages`, {
            params: {
                order_by: 'created_at',
                sort: 'desc',
                per_page: 10
            }
        });

        console.log('Packages found:');
        response.data.forEach(pkg => {
            console.log(`Package name: ${pkg.name}, version: ${pkg.version}`);
        });

        const binariesPackage = response.data.find(pkg =>
            pkg.name.includes('octez-binaries') &&
            !pkg.name.includes('beta') &&
            pkg.version === '20.2'
        );

        if (!binariesPackage) {
            console.error(`No binaries package found for architecture ${arch}`);
            return null;
        }

        console.log(`Selected package: ${binariesPackage.name}, version: ${binariesPackage.version}`);

        const packageFilesResponse = await axios.get(`${GITLAB_API_URL}/${PROJECT_ID}/packages/${binariesPackage.id}/package_files`);

        console.log('Package files found:');
        const packageFile = packageFilesResponse.data.find(file => file.file_name.includes(`${arch}-octez-client`));

        if (!packageFile) {
            console.error(`No client package file found for architecture ${arch}`);
            return null;
        }

        const clientDownloadUrl = `${GITLAB_API_URL}/${PROJECT_ID}/package_files/${packageFile.id}/download`;

        const nodePackageFile = packageFilesResponse.data.find(file => file.file_name.includes(`${arch}-octez-node`));
        if (!nodePackageFile) {
            console.error(`No node package file found for architecture ${arch}`);
            return null;
        }

        const nodeDownloadUrl = `${GITLAB_API_URL}/${PROJECT_ID}/package_files/${nodePackageFile.id}/download`;

        console.log(`Selected client file: ${packageFile.file_name}, download URL: ${clientDownloadUrl}`);
        console.log(`Selected node file: ${nodePackageFile.file_name}, download URL: ${nodeDownloadUrl}`);

        return {
            version: binariesPackage.version,
            clientUrl: clientDownloadUrl,
            nodeUrl: nodeDownloadUrl
        };
    } catch (error) {
        console.error(`Error retrieving latest binaries package URL for architecture ${arch}:`, error.message);
        return null;
    }
}

async function installDependencies() {
    console.log('Checking for missing dependencies...');
    try {
        execSync('sudo apt-get install -f -y');
        console.log('Dependencies installed successfully.');
    } catch (error) {
        console.error('Error installing dependencies:', error.message);
        process.exit(1);
    }
}

async function installTezosNode() {
    const { distro } = await getOS();
    const arch = getArchitecture();

    console.log(`Downloading and installing octez-client and octez-node for ${distro} (${arch})...`);

    const binariesPackageInfo = await getLatestBinariesPackageInfo(arch);

    if (!binariesPackageInfo) {
        console.error('Unable to find binaries package URLs for the specified architecture.');
        process.exit(1);
    }

    if (isPackageInstalled('octez-client')) {
        console.log('octez-client is already installed.');
    } else {
        console.log('Downloading octez-client...');
        await downloadFile(binariesPackageInfo.clientUrl, '/tmp/octez-client.deb');
        console.log('Installing octez-client...');
        execSync(`sudo dpkg -i /tmp/octez-client.deb`);
        fs.unlinkSync('/tmp/octez-client.deb');
    }

    if (isPackageInstalled('octez-node')) {
        console.log('octez-node is already installed.');
    } else {
        console.log('Downloading octez-node...');
        await downloadFile(binariesPackageInfo.nodeUrl, '/tmp/octez-node.deb');
        console.log('Installing octez-node...');
        execSync(`sudo dpkg -i /tmp/octez-node.deb`);
        fs.unlinkSync('/tmp/octez-node.deb');
    }
}

async function installTezosBaker(protocolHash) {
    const { distro } = await getOS();
    const arch = getArchitecture();

    console.log(`Downloading and installing octez-baker for ${distro} (${arch})...`);

    const binariesPackageInfo = await getLatestBinariesPackageInfo(arch);

    if (!binariesPackageInfo) {
        console.error(`Unable to find baker package URL for protocol ${protocolHash}, distro ${distro}, and architecture ${arch}.`);
        process.exit(1);
    }

    const bakerPackageFile = binariesPackageInfo.packageFilesResponse.data.find(file =>
        file.file_name.includes(`${arch}-octez-baker-${protocolHash.slice(0, 8)}`)
    );

    if (!bakerPackageFile) {
        console.error(`No baker package file found for protocol ${protocolHash}`);
        return;
    }

    const bakerDownloadUrl = `${GITLAB_API_URL}/${PROJECT_ID}/package_files/${bakerPackageFile.id}/download`;

    console.log('Downloading octez-baker...');
    await downloadFile(bakerDownloadUrl, `/tmp/octez-baker-${protocolHash}.deb`);
    console.log('Installing octez-baker...');
    execSync(`sudo dpkg -i /tmp/octez-baker-${protocolHash}.deb`);
    fs.unlinkSync(`/tmp/octez-baker-${protocolHash}.deb`);
}

module.exports = {
    getLatestBinariesPackageInfo,
    downloadFile,
    isPackageInstalled,
    installTezosNode,
    installTezosBaker
};
