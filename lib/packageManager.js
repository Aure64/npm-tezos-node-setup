const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');
const getOS = require('./getOS');
const downloadFile = require('./downloadFile');

const GITLAB_API_URL = 'https://gitlab.com';
const PROJECT_ID = 'tezos/tezos';

// Remove the architecture detection function since it's no longer needed

function getInstalledVersion(binaryName) {
    try {
        const versionOutput = execSync(`${binaryName} --version`).toString().trim();
        const versionMatch = versionOutput.match(/(\d+\.\d+)/); // assuming version is in the form "20.2"
        if (versionMatch) {
            return versionMatch[0];
        }
    } catch (error) {
        // If the binary is not found or the version command fails, assume it's not installed
        return null;
    }
    return null;
}

async function getLatestBinariesPackageInfo() {
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
            !pkg.name.includes('test')
        );

        if (!binariesPackage) {
            console.error(`No suitable binaries package found.`);
            return null;
        }

        const packageFilesResponse = await axios.get(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(PROJECT_ID)}/packages/${binariesPackage.id}/package_files`);

        const packageFiles = {
            node: packageFilesResponse.data.find(file => file.file_name.includes('octez-node') && file.file_name.endsWith('.deb')),
            client: packageFilesResponse.data.find(file => file.file_name.includes('octez-client') && file.file_name.endsWith('.deb')),
            baker: packageFilesResponse.data.filter(file => file.file_name.includes('octez-baker') && file.file_name.endsWith('.deb')),
            files: packageFilesResponse.data
        };

        if (!packageFiles.node || !packageFiles.client) {
            console.error(`Required package files not found.`);
            return null;
        }

        return {
            version: binariesPackage.version,
            nodeUrl: `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.node.id}/download`,
            clientUrl: `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.client.id}/download`,
            bakerFiles: packageFiles.baker,
            files: packageFilesResponse.data
        };
    } catch (error) {
        console.error(`Error retrieving latest binaries package URL:`, error.message);
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

    const installedClientVersion = getInstalledVersion('octez-client');
    const installedNodeVersion = getInstalledVersion('octez-node');

    const binariesPackageInfo = await getLatestBinariesPackageInfo();

    if (!binariesPackageInfo) {
        console.error('Unable to find binaries package URLs.');
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

async function installTezosBaker(protocolHash) {
    const binariesPackageInfo = await getLatestBinariesPackageInfo();

    if (!binariesPackageInfo) {
        console.error('No binaries package info retrieved.');
        process.exit(1);
    }

    if (!binariesPackageInfo.bakerFiles || binariesPackageInfo.bakerFiles.length === 0) {
        console.error('No baker files found in the binaries package info.');
        process.exit(1);
    }

    const bakerFile = binariesPackageInfo.bakerFiles.find(file =>
        protocolHash.startsWith(file.file_name.split('-').pop().replace('.deb', ''))
    );

    if (!bakerFile) {
        console.error(`Baker binary not found for protocol ${protocolHash}`);
        process.exit(1);
    }

    const tmpBakerPath = `/tmp/${bakerFile.file_name}`;

    try {
        console.log(`Downloading ${bakerFile.file_name}...`);
        await downloadFile(`${GITLAB_API_URL}/tezos/tezos/-/package_files/${bakerFile.id}/download`, tmpBakerPath);
        await installPackageOrBinary(tmpBakerPath, `octez-baker`);
        console.log(`${bakerFile.file_name} installed/updated successfully.`);
    } finally {
        if (fs.existsSync(tmpBakerPath)) {
            fs.unlinkSync(tmpBakerPath);
        }
    }
}

async function installPackageOrBinary(filePath, binaryName) {
    try {
        execSync(`sudo dpkg -i ${filePath}`);
    } catch (error) {
        console.error(`Error installing ${binaryName}, attempting to fix dependencies...`);
        await installDependencies();
        execSync(`sudo dpkg -i ${filePath}`);
    }
}

module.exports = {
    getLatestBinariesPackageInfo,
    downloadFile,
    installTezosNode,
    installTezosBaker,
    installPackageOrBinary
};
