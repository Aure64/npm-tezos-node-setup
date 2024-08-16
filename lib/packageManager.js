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
        packageFilesResponse.data.forEach(file => {
            console.log(`File name: ${file.file_name}, download URL: ${file.url}`);
        });

        const packageFile = packageFilesResponse.data.find(file => file.file_name.includes(`${arch}-octez`));
        if (!packageFile) {
            console.error(`No package file found for architecture ${arch}`);
            return null;
        }

        const downloadUrl = `${GITLAB_API_URL}/${PROJECT_ID}/package_files/${packageFile.id}/download`;

        console.log(`Selected file: ${packageFile.file_name}, download URL: ${downloadUrl}`);

        return {
            version: binariesPackage.version,
            url: downloadUrl
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

    const tmpClientPath = '/tmp/octez-client';
    const tmpNodePath = '/tmp/octez-node';

    try {
        console.log('Downloading octez-client...');
        await downloadFile(binariesPackageInfo.url, tmpClientPath);
        console.log('Downloading octez-node...');
        await downloadFile(binariesPackageInfo.url, tmpNodePath);

        await installPackageOrBinary(tmpClientPath, 'octez-client');
        await installPackageOrBinary(tmpNodePath, 'octez-node');

        console.log('octez-client and octez-node installed successfully.');
    } finally {
        if (fs.existsSync(tmpClientPath)) {
            fs.unlinkSync(tmpClientPath);
            console.log(`Temporary file removed: ${tmpClientPath}`);
        }
        if (fs.existsSync(tmpNodePath)) {
            fs.unlinkSync(tmpNodePath);
            console.log(`Temporary file removed: ${tmpNodePath}`);
        }
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

    const tmpBakerPath = `/tmp/octez-baker-${protocolHash}`;

    try {
        console.log('Downloading octez-baker...');
        await downloadFile(binariesPackageInfo.url, tmpBakerPath);
        console.log('Installing octez-baker...');
        await installPackageOrBinary(tmpBakerPath, `octez-baker-${protocolHash}`);
    } finally {
        if (fs.existsSync(tmpBakerPath)) {
            fs.unlinkSync(tmpBakerPath);
            console.log(`Temporary file removed: ${tmpBakerPath}`);
        }
    }
}

async function installPackageOrBinary(filePath, binaryName) {
    const fileType = execSync(`file -b ${filePath}`).toString().trim();

    if (fileType.includes('Debian binary package')) {
        console.log(`Installing ${binaryName} as a Debian package...`);
        try {
            execSync(`sudo dpkg -i ${filePath}`);
        } catch (error) {
            console.error(`Error installing ${binaryName}, attempting to fix dependencies...`);
            await installDependencies();
            execSync(`sudo dpkg -i ${filePath}`);
        }
    } else if (fileType.includes('ELF')) {
        console.log(`Installing ${binaryName} as a binary...`);
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
