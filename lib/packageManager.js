const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');
const getOS = require('./getOS');
const downloadFile = require('./downloadFile');
const isPackageInstalled = require('./isPackageInstalled');

const GITLAB_API_URL = 'https://gitlab.com/api/v4/projects';
const PROJECT_ID = encodeURIComponent('tezos/tezos');

async function getLatestPackageInfo(packageName, distro) {
    try {
        const response = await axios.get(`${GITLAB_API_URL}/${PROJECT_ID}/packages`, {
            params: {
                search: packageName,
                order_by: 'created_at',
                sort: 'desc',
                per_page: 10
            }
        });

        const pkg = response.data.find(pkg => pkg.name.includes(distro));
        if (!pkg) {
            console.error(`No package found for ${packageName} on ${distro}`);
            return null;
        }

        const packageFilesResponse = await axios.get(`${GITLAB_API_URL}/${PROJECT_ID}/packages/${pkg.id}/package_files`);

        const packageFile = packageFilesResponse.data.find(file => file.file_name.includes(packageName));
        if (!packageFile) {
            console.error(`No package file found for ${packageName}`);
            return null;
        }

        return {
            version: pkg.version,
            url: `https://gitlab.com/tezos/tezos/-/package_files/${packageFile.id}/download`
        };
    } catch (error) {
        console.error(`Error retrieving latest package URL for ${packageName}:`, error.message);
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

async function installTezosTools() {
    const { distro } = await getOS();

    console.log(`Downloading and installing octez-client, octez-node, and octez-baker for ${distro}...`);

    const clientPackageInfo = await getLatestPackageInfo('octez-client', distro);
    const nodePackageInfo = await getLatestPackageInfo('octez-node', distro);
    const bakerPackageInfo = await getLatestPackageInfo('octez-baker', distro);

    if (!clientPackageInfo || !nodePackageInfo || !bakerPackageInfo) {
        console.error('Unable to find package URLs for the specified distribution.');
        process.exit(1);
    }

    const installedClient = isPackageInstalled('octez-client');
    const installedNode = isPackageInstalled('octez-node');
    const installedBaker = isPackageInstalled('octez-baker');

    const tmpClientPath = '/tmp/octez-client.deb';
    const tmpNodePath = '/tmp/octez-node.deb';
    const tmpBakerPath = '/tmp/octez-baker.deb';

    try {
        if (!installedClient || installedClient.version !== clientPackageInfo.version) {
            console.log('Downloading octez-client...');
            await downloadFile(clientPackageInfo.url, tmpClientPath);
            console.log('Installing octez-client...');
            try {
                execSync(`sudo dpkg -i ${tmpClientPath}`);
            } catch (error) {
                console.error('Error installing octez-client, attempting to fix dependencies...');
                await installDependencies();
                execSync(`sudo dpkg -i ${tmpClientPath}`);
            }
        } else {
            console.log(`octez-client already installed. Version: ${installedClient.version}`);
        }

        if (!installedNode || installedNode.version !== nodePackageInfo.version) {
            console.log('Downloading octez-node...');
            await downloadFile(nodePackageInfo.url, tmpNodePath);
            console.log('Installing octez-node...');
            try {
                execSync(`sudo dpkg -i ${tmpNodePath}`);
            } catch (error) {
                console.error('Error installing octez-node, attempting to fix dependencies...');
                await installDependencies();
                execSync(`sudo dpkg -i ${tmpNodePath}`);
            }
        } else {
            console.log(`octez-node already installed. Version: ${installedNode.version}`);
        }

        if (!installedBaker || installedBaker.version !== bakerPackageInfo.version) {
            console.log('Downloading octez-baker...');
            await downloadFile(bakerPackageInfo.url, tmpBakerPath);
            console.log('Installing octez-baker...');
            try {
                execSync(`sudo dpkg -i ${tmpBakerPath}`);
            } catch (error) {
                console.error('Error installing octez-baker, attempting to fix dependencies...');
                await installDependencies();
                execSync(`sudo dpkg -i ${tmpBakerPath}`);
            }
        } else {
            console.log(`octez-baker already installed. Version: ${installedBaker.version}`);
        }
    } finally {
        // Remove downloaded files
        if (fs.existsSync(tmpClientPath)) {
            fs.unlinkSync(tmpClientPath);
            console.log(`Temporary file removed: ${tmpClientPath}`);
        }
        if (fs.existsSync(tmpNodePath)) {
            fs.unlinkSync(tmpNodePath);
            console.log(`Temporary file removed: ${tmpNodePath}`);
        }
        if (fs.existsSync(tmpBakerPath)) {
            fs.unlinkSync(tmpBakerPath);
            console.log(`Temporary file removed: ${tmpBakerPath}`);
        }
    }
}

module.exports = {
    getLatestPackageInfo,
    downloadFile,
    isPackageInstalled,
    installTezosTools
};
