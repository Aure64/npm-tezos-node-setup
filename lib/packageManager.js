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
    console.log(`Detected architecture: ${arch}`); // Log de l'architecture détectée
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

        // Sélectionne le package binaire sans "beta" pour l'architecture donnée
        const binariesPackage = response.data.find(pkg =>
            pkg.name.includes('octez-binaries') &&
            !pkg.name.includes('beta') &&
            pkg.version === '20.2'  // Ajoutez cette ligne pour forcer la version 20.2, ou ajustez-la selon votre besoin
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

        console.log(`Selected file: ${packageFile.file_name}, download URL: ${packageFile.url}`);

        return {
            version: binariesPackage.version,
            url: `https://gitlab.com/tezos/tezos/-/package_files/${packageFile.id}/download`
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
    const arch = getArchitecture(); // Log d'architecture ajouté ici

    console.log(`Downloading and installing octez-client and octez-node for ${distro} (${arch})...`);

    const binariesPackageInfo = await getLatestBinariesPackageInfo(arch);

    if (!binariesPackageInfo) {
        console.error('Unable to find binaries package URLs for the specified architecture.');
        process.exit(1);
    }

    const installedClient = isPackageInstalled('octez-client');
    const installedNode = isPackageInstalled('octez-node');

    const tmpClientPath = '/tmp/octez-client.deb';
    const tmpNodePath = '/tmp/octez-node.deb';

    try {
        console.log('Downloading octez-client and octez-node...');
        await downloadFile(binariesPackageInfo.url, tmpClientPath);
        console.log('Installing octez-client and octez-node...');
        try {
            execSync(`sudo dpkg -i ${tmpClientPath}`);
        } catch (error) {
            console.error('Error installing octez-client or octez-node, attempting to fix dependencies...');
            await installDependencies();
            execSync(`sudo dpkg -i ${tmpClientPath}`);
        }
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
    const arch = getArchitecture(); // Log d'architecture ajouté ici

    console.log(`Downloading and installing octez-baker for ${distro} (${arch})...`);

    const binariesPackageInfo = await getLatestBinariesPackageInfo(arch);

    if (!binariesPackageInfo) {
        console.error(`Unable to find baker package URL for protocol ${protocolHash}, distro ${distro}, and architecture ${arch}.`);
        process.exit(1);
    }

    const tmpBakerPath = `/tmp/octez-baker-${protocolHash}.deb`;

    try {
        console.log('Downloading octez-baker...');
        await downloadFile(binariesPackageInfo.url, tmpBakerPath);
        console.log('Installing octez-baker...');
        try {
            execSync(`sudo dpkg -i ${tmpBakerPath}`);
        } catch (error) {
            console.error('Error installing octez-baker, attempting to fix dependencies...');
            await installDependencies();
            execSync(`sudo dpkg -i ${tmpBakerPath}`);
        }
    } finally {
        if (fs.existsSync(tmpBakerPath)) {
            fs.unlinkSync(tmpBakerPath);
            console.log(`Temporary file removed: ${tmpBakerPath}`);
        }
    }
}

module.exports = {
    getLatestBinariesPackageInfo,
    downloadFile,
    isPackageInstalled,
    installTezosNode,
    installTezosBaker
};
