const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');
const getOS = require('./getOS');
const downloadFile = require('./downloadFile');
const isPackageInstalled = require('./isPackageInstalled');

const GITLAB_API_URL = 'https://gitlab.com';
const PROJECT_ID = 'tezos/tezos';

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

async function getLatestBinariesPackageInfo(arch, downloadBaker = false) {
    try {
        const response = await axios.get(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(PROJECT_ID)}/packages`, {
            params: {
                order_by: 'created_at',
                sort: 'desc',
                per_page: 10
            }
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

        const packageFilesResponse = await axios.get(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(PROJECT_ID)}/packages/${binariesPackage.id}/package_files`);

        const packageFiles = {
            node: packageFilesResponse.data.find(file => file.file_name.includes(`${arch}-octez-node`)),
            client: packageFilesResponse.data.find(file => file.file_name.includes(`${arch}-octez-client`)),
            baker: downloadBaker ? packageFilesResponse.data.find(file => file.file_name.includes(`${arch}-octez-baker-PsParisC`)) : null
        };

        if (!packageFiles.node || !packageFiles.client || (downloadBaker && !packageFiles.baker)) {
            console.error(`Required package files not found for architecture ${arch}`);
            return null;
        }

        return {
            nodeUrl: `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.node.id}/download`,
            clientUrl: `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.client.id}/download`,
            bakerUrl: downloadBaker ? `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.baker.id}/download` : null
        };
    } catch (error) {
        console.error(`Error retrieving latest binaries package URL for architecture ${arch}:`, error.message);
        return null;
    }
}

async function installDependencies() {
    try {
        execSync('sudo apt-get install -f -y');
    } catch (error) {
        console.error('Error installing dependencies:', error.message);
        process.exit(1);
    }
}

async function installTezosNode() {
    const { distro } = await getOS();
    const arch = getArchitecture();

    if (isPackageInstalled('octez-client') && isPackageInstalled('octez-node')) {
        console.log('octez-client and octez-node are already installed. Skipping installation.');
        return;
    }

    const binariesPackageInfo = await getLatestBinariesPackageInfo(arch);

    if (!binariesPackageInfo) {
        console.error('Unable to find binaries package URLs for the specified architecture.');
        process.exit(1);
    }

    const tmpClientPath = '/tmp/octez-client';
    const tmpNodePath = '/tmp/octez-node';

    try {
        console.log('Downloading octez-client...');
        await downloadFile(binariesPackageInfo.clientUrl, tmpClientPath);
        console.log('Downloading octez-node...');
        await downloadFile(binariesPackageInfo.nodeUrl, tmpNodePath);

        await installPackageOrBinary(tmpClientPath, 'octez-client');
        await installPackageOrBinary(tmpNodePath, 'octez-node');

        console.log('octez-client and octez-node installed successfully.');
    } finally {
        if (fs.existsSync(tmpClientPath)) {
            fs.unlinkSync(tmpClientPath);
        }
        if (fs.existsSync(tmpNodePath)) {
            fs.unlinkSync(tmpNodePath);
        }
    }
}

async function installTezosBaker(protocolHash) {
    const { distro } = await getOS();
    const arch = getArchitecture();

    const binariesPackageInfo = await getLatestBinariesPackageInfo(arch, true);

    if (!binariesPackageInfo) {
        console.error(`Unable to find baker package URL for protocol ${protocolHash}, distro ${distro}, and architecture ${arch}.`);
        process.exit(1);
    }

    const tmpBakerPath = `/tmp/octez-baker-${protocolHash}`;

    try {
        console.log('Downloading octez-baker...');
        await downloadFile(binariesPackageInfo.bakerUrl, tmpBakerPath);
        console.log('Installing octez-baker...');
        await installPackageOrBinary(tmpBakerPath, `octez-baker-${protocolHash}`);
    } finally {
        if (fs.existsSync(tmpBakerPath)) {
            fs.unlinkSync(tmpBakerPath);
        }
    }
}

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
    isPackageInstalled,
    installTezosNode,
    installTezosBaker
};
