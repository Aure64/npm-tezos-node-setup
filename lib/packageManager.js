const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');
const getOS = require('./getOS');
const downloadFile = require('./downloadFile');

const GITLAB_API_URL = 'https://gitlab.com';
const PROJECT_ID = 'tezos/tezos';

function getInstalledVersion(binaryName) {
    try {
        console.log(`[packageManager] Checking installed version of ${binaryName}`);
        const versionOutput = execSync(`${binaryName} --version`).toString().trim();
        const versionMatch = versionOutput.match(/(\d+\.\d+)/);
        if (versionMatch) {
            console.log(`[packageManager] Found installed version: ${versionMatch[0]}`);
            return versionMatch[0];
        }
    } catch (error) {
        console.log(`[packageManager] ${binaryName} not found or version check failed.`);
        return null;
    }
    return null;
}

async function getLatestBinariesPackageInfo(distro, version) {
    console.log(`[packageManager] Fetching latest binaries package info for distro: ${distro}, version: ${version}`);
    try {
        const response = await axios.get(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(PROJECT_ID)}/packages`, {
            params: {
                order_by: 'created_at',
                sort: 'desc',
                per_page: 50
            }
        });

        console.log(`[packageManager] Retrieved ${response.data.length} packages`);

        // Normalize distro and version for matching
        const normalizedDistro = distro.toLowerCase();
        const possibleMatches = [
            `${normalizedDistro}-${version}`,
            `${normalizedDistro}`,
            `${distro}-${version}`,
            `${distro}`,
            `${version}`,
            `-${normalizedDistro}`,
        ];

        // Find the most appropriate package for the detected distro and version
        const latestPackage = response.data.find(pkg => {
            return possibleMatches.some(match => pkg.name.includes(`octez-${match}`)) &&
                !pkg.name.includes('beta') &&
                !pkg.name.includes('test');
        });

        if (!latestPackage) {
            console.error(`[packageManager] No suitable binaries package found for distro: ${distro}, version: ${version}`);
            return null;
        }

        console.log(`[packageManager] Found binaries package: ${latestPackage.name}, version: ${latestPackage.version}`);

        const packageFilesResponse = await axios.get(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(PROJECT_ID)}/packages/${latestPackage.id}/package_files`);

        console.log(`[packageManager] Retrieved ${packageFilesResponse.data.length} files for package ${latestPackage.name}`);
        packageFilesResponse.data.forEach(file => console.log(`[packageManager] File found: ${file.file_name}`));

        const packageFiles = {
            node: packageFilesResponse.data.find(file => file.file_name.includes('octez-node')),
            client: packageFilesResponse.data.find(file => file.file_name.includes('octez-client')),
            baker: packageFilesResponse.data.find(file => file.file_name.includes('octez-baker'))
        };

        if (!packageFiles.node || !packageFiles.client) {
            console.error(`[packageManager] Required package files not found in: ${latestPackage.name}`);
            return null;
        }

        console.log(`[packageManager] Package files found: node=${packageFiles.node.file_name}, client=${packageFiles.client.file_name}, baker=${packageFiles.baker ? packageFiles.baker.file_name : 'not found'}`);

        return {
            version: latestPackage.version,
            nodeUrl: `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.node.id}/download`,
            clientUrl: `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.client.id}/download`,
            bakerUrl: packageFiles.baker ? `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.baker.id}/download` : null
        };
    } catch (error) {
        console.error(`[packageManager] Error retrieving latest binaries package for distro: ${distro}, version: ${version}`, error.message);
        return null;
    }
}

async function installDependencies() {
    try {
        console.log('[packageManager] Installing dependencies...');
        execSync('sudo apt-get install -f -y');
        console.log('[packageManager] Dependencies installed successfully.');
    } catch (error) {
        console.error('Error installing dependencies:', error.message);
        process.exit(1);
    }
}

async function installTezosNode() {
    console.log('[packageManager] Starting installation of Tezos node...');
    const { distro, version } = await getOS();
    console.log(`[packageManager] Detected OS: ${distro}, version: ${version}`);

    const installedClientVersion = getInstalledVersion('octez-client');
    const installedNodeVersion = getInstalledVersion('octez-node');

    const binariesPackageInfo = await getLatestBinariesPackageInfo(distro, version);

    if (!binariesPackageInfo) {
        console.error('Unable to find binaries package URLs for the specified distro.');
        process.exit(1);
    }

    if (installedClientVersion === binariesPackageInfo.version && installedNodeVersion === binariesPackageInfo.version) {
        console.log('octez-client and octez-node are already up to date. No action needed.');
        return;
    } else {
        console.log(`[packageManager] Current version: client=${installedClientVersion}, node=${installedNodeVersion}`);
        console.log(`[packageManager] Latest version: ${binariesPackageInfo.version}`);
    }

    const tmpClientPath = '/tmp/octez-client.deb';
    const tmpNodePath = '/tmp/octez-node.deb';

    try {
        if (installedClientVersion !== binariesPackageInfo.version) {
            console.log('[packageManager] Downloading octez-client...');
            await downloadFile(binariesPackageInfo.clientUrl, tmpClientPath);
            await installPackageOrBinary(tmpClientPath, 'octez-client');
        }

        if (installedNodeVersion !== binariesPackageInfo.version) {
            console.log('[packageManager] Downloading octez-node...');
            await downloadFile(binariesPackageInfo.nodeUrl, tmpNodePath);
            await installPackageOrBinary(tmpNodePath, 'octez-node');
        }

        console.log('[packageManager] octez-client and octez-node installed/updated successfully.');
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
    console.log('[packageManager] Starting installation of Tezos baker...');
    const { distro, version } = await getOS();
    console.log(`[packageManager] Detected OS: ${distro}, version: ${version}`);

    const binariesPackageInfo = await getLatestBinariesPackageInfo(distro, version);

    if (!binariesPackageInfo || !binariesPackageInfo.bakerUrl) {
        console.error('No baker binaries package info retrieved.');
        process.exit(1);
    }

    const tmpBakerPath = '/tmp/octez-baker.deb';

    try {
        console.log('[packageManager] Downloading octez-baker...');
        await downloadFile(binariesPackageInfo.bakerUrl, tmpBakerPath);
        await installPackageOrBinary(tmpBakerPath, 'octez-baker');
        console.log('[packageManager] octez-baker installed/updated successfully.');
    } finally {
        if (fs.existsSync(tmpBakerPath)) {
            fs.unlinkSync(tmpBakerPath);
        }
    }
}

async function installPackageOrBinary(filePath, binaryName) {
    console.log(`[packageManager] Installing package or binary: ${binaryName}`);
    const fileType = execSync(`file -b ${filePath}`).toString().trim();

    if (fileType.includes('Debian binary package')) {
        try {
            console.log(`[packageManager] Installing ${binaryName} from .deb package...`);
            execSync(`sudo dpkg -i ${filePath}`);
        } catch (error) {
            console.error(`[packageManager] Error installing ${binaryName}, attempting to fix dependencies...`);
            await installDependencies();
            execSync(`sudo dpkg -i ${filePath}`);
        }
    } else if (fileType.includes('ELF')) {
        const destinationPath = `/usr/bin/${binaryName}`;
        execSync(`sudo mv ${filePath} ${destinationPath}`);
        execSync(`sudo chmod +x ${destinationPath}`);
        console.log(`[packageManager] ${binaryName} installed successfully to ${destinationPath}.`);
    } else {
        console.error(`[packageManager] Unsupported file type for ${binaryName}: ${fileType}`);
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
