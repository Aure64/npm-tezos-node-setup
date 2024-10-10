const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const getOS = require('./getOS');
const downloadFile = require('./downloadFile');

const GITLAB_API_URL = 'https://gitlab.com';
const PROJECT_ID = 'tezos/tezos';

// Function to download and install Zcash parameters
async function installZcashParams() {
    const zcashDirs = [
        '/usr/share/zcash-params',
        '/usr/local/share/zcash-params',
        '/_opam/share/zcash-params'
    ];

    const paramsExist = zcashDirs.some(dir => fs.existsSync(dir) && fs.readdirSync(dir).length > 0);
    if (!paramsExist) {
        console.log('Zcash parameters not found. Downloading...');

        const fetchParamsUrl = 'https://raw.githubusercontent.com/zcash/zcash/713fc761dd9cf4c9087c37b078bdeab98697bad2/zcutil/fetch-params.sh';
        const fetchParamsPath = '/tmp/fetch-params.sh';
        await downloadFile(fetchParamsUrl, fetchParamsPath);

        execSync(`chmod +x ${fetchParamsPath}`);
        execSync(fetchParamsPath, { stdio: 'inherit' });

        const zcashDir = '/usr/share/zcash-params';
        execSync(`sudo mkdir -p ${zcashDir}`);
        execSync(`sudo mv ~/.zcash-params/* ${zcashDir}/`);
        execSync(`rm -rf ~/.zcash-params`);
        console.log('Zcash parameters installed.');
    } else {
        console.log('Zcash parameters are already installed.');
    }
}

// Function to get installed version of a binary
function getInstalledVersion(binaryName) {
    try {
        const versionOutput = execSync(`${binaryName} --version`).toString().trim();
        return versionOutput.match(/(\d+\.\d+)/)?.[0] || null;
    } catch {
        return null;
    }
}

// Function to fetch latest binaries package info for a given distro
async function getLatestBinariesPackageInfo(distro) {
    try {
        const response = await axios.get(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(PROJECT_ID)}/packages`, {
            params: { order_by: 'created_at', sort: 'desc', per_page: 500 }
        });

        const stablePackages = response.data.filter(pkg =>
            pkg.name.includes(distro) &&
            !pkg.name.includes('beta') &&
            !pkg.name.includes('test') &&
            /^\d+\.\d+(\.\d+)?$/.test(pkg.version)
        );

        if (stablePackages.length === 0) {
            console.error('No stable packages found for the specified distro.');
            return null;
        }

        const latestPackage = stablePackages.reduce((latest, pkg) =>
            parseFloat(pkg.version) > parseFloat(latest.version) ? pkg : latest
        );

        const packageFilesResponse = await axios.get(`${GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(PROJECT_ID)}/packages/${latestPackage.id}/package_files`);
        const packageFiles = {
            node: packageFilesResponse.data.find(file => file.file_name.includes('octez-node')),
            client: packageFilesResponse.data.find(file => file.file_name.includes('octez-client')),
            baker: packageFilesResponse.data.find(file => file.file_name.includes('octez-baker'))
        };

        if (!packageFiles.node || !packageFiles.client) {
            console.error('Node or client binaries not found in package files.');
            return null;
        }

        return {
            version: latestPackage.version,
            nodeUrl: `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.node.id}/download`,
            clientUrl: `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.client.id}/download`,
            bakerUrl: packageFiles.baker ? `${GITLAB_API_URL}/tezos/tezos/-/package_files/${packageFiles.baker.id}/download` : null
        };
    } catch (error) {
        console.error(`Error fetching binaries package info: ${error.message}`);
        return null;
    }
}

// Function to install or update Tezos Node
async function installTezosNode() {
    const { distro } = await getOS();
    const installedClientVersion = getInstalledVersion('octez-client');
    const installedNodeVersion = getInstalledVersion('octez-node');

    console.log(`Current installed versions - Client: ${installedClientVersion || 'Not installed'}, Node: ${installedNodeVersion || 'Not installed'}`);

    const binariesPackageInfo = await getLatestBinariesPackageInfo(distro);
    if (!binariesPackageInfo) {
        console.error('Unable to find binaries package URLs for the specified distro.');
        process.exit(1);
    }

    if (installedClientVersion === binariesPackageInfo.version && installedNodeVersion === binariesPackageInfo.version) {
        console.log('Installed versions are up to date. No download needed.');
        return;
    }

    const tmpClientPath = '/tmp/octez-client.deb';
    const tmpNodePath = '/tmp/octez-node.deb';

    try {
        if (installedClientVersion !== binariesPackageInfo.version) {
            console.log(`Downloading octez-client from ${binariesPackageInfo.clientUrl}...`);
            await downloadFile(binariesPackageInfo.clientUrl, tmpClientPath);
            await installPackageOrBinary(tmpClientPath, 'octez-client');
        }

        if (installedNodeVersion !== binariesPackageInfo.version) {
            console.log(`Downloading octez-node from ${binariesPackageInfo.nodeUrl}...`);
            await downloadFile(binariesPackageInfo.nodeUrl, tmpNodePath);
            await installPackageOrBinary(tmpNodePath, 'octez-node');
        }
    } finally {
        fs.unlinkSync(tmpClientPath, (err) => { if (err) console.error(err); });
        fs.unlinkSync(tmpNodePath, (err) => { if (err) console.error(err); });
    }
}

// Function to install Tezos Baker
async function installTezosBaker(protocolHash) {
    const { distro } = await getOS();

    // Attempt to find the correct baker binary based on the protocol hash
    let bakerBinaries;
    try {
        bakerBinaries = execSync('ls /usr/bin/octez-baker-*').toString().split('\n').map(file => path.basename(file));
        console.log('Existing baker binaries found.');
    } catch (error) {
        console.log('No octez-baker binaries found, proceeding with download...');
        bakerBinaries = [];
    }

    // Check for the binary that corresponds to the current protocol
    const bakerBinary = bakerBinaries.find(binary => binary.includes(protocolHash.slice(0, 8)));

    if (bakerBinary) {
        console.log(`Using existing baker binary: ${bakerBinary}`);
        return; // No need to download, binary exists
    }

    // If no matching binary is found, proceed with download
    console.log(`No matching baker binary found for protocol ${protocolHash}. Downloading...`);

    const binariesPackageInfo = await getLatestBinariesPackageInfo(distro);

    if (!binariesPackageInfo || !binariesPackageInfo.bakerUrl) {
        console.error('No baker binaries package info retrieved.');
        process.exit(1);
    }

    const tmpBakerPath = '/tmp/octez-baker.deb';

    try {
        console.log(`Downloading baker from: ${binariesPackageInfo.bakerUrl}`);
        await downloadFile(binariesPackageInfo.bakerUrl, tmpBakerPath);
        await installPackageOrBinary(tmpBakerPath, 'octez-baker');
    } finally {
        if (fs.existsSync(tmpBakerPath)) {
            fs.unlinkSync(tmpBakerPath);
        }
    }
}

// Function to install Etherlink nodes
async function installEtherlinkNodes() {
    const { distro } = await getOS();
    const binariesPackageInfo = await getLatestBinariesPackageInfo(distro);

    if (!binariesPackageInfo) {
        console.error('Unable to find binaries package URLs for the specified distro.');
        process.exit(1);
    }

    const tmpSmartRollupPath = '/tmp/octez-smartrollup.deb';
    const tmpEvmNodePath = '/tmp/octez-evmnode.deb';

    try {
        await downloadFile(binariesPackageInfo.smartRollupUrl, tmpSmartRollupPath);
        await downloadFile(binariesPackageInfo.evmNodeUrl, tmpEvmNodePath);

        await installPackageOrBinary(tmpSmartRollupPath, 'octez-smartrollup');
        await installPackageOrBinary(tmpEvmNodePath, 'octez-evmnode');
    } finally {
        fs.unlinkSync(tmpSmartRollupPath, (err) => { if (err) console.error(err); });
        fs.unlinkSync(tmpEvmNodePath, (err) => { if (err) console.error(err); });
    }
}

// Function to install a package or binary
async function installPackageOrBinary(filePath, binaryName) {
    const fileType = execSync(`file -b ${filePath}`).toString().trim();

    if (fileType.includes('Debian binary package')) {
        execSync(`sudo dpkg -i ${filePath}`);
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
    installEtherlinkNodes,
    installPackageOrBinary,
    installZcashParams
};
