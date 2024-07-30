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
            console.error(`Aucun package trouvé pour ${packageName} sur ${distro}`);
            return null;
        }

        const packageFilesResponse = await axios.get(`${GITLAB_API_URL}/${PROJECT_ID}/packages/${pkg.id}/package_files`);

        const packageFile = packageFilesResponse.data.find(file => file.file_name.includes(packageName));
        if (!packageFile) {
            console.error(`Aucun fichier de package trouvé pour ${packageName}`);
            return null;
        }

        return {
            version: pkg.version,
            url: `https://gitlab.com/tezos/tezos/-/package_files/${packageFile.id}/download`
        };
    } catch (error) {
        console.error(`Erreur lors de la récupération de l'URL du dernier package pour ${packageName}:`, error.message);
        return null;
    }
}

async function installTezosTools() {
    const { distro } = await getOS();

    console.log(`Téléchargement et installation de octez-client et octez-node pour ${distro}...`);

    const clientPackageInfo = await getLatestPackageInfo('octez-client', distro);
    const nodePackageInfo = await getLatestPackageInfo('octez-node', distro);

    if (!clientPackageInfo || !nodePackageInfo) {
        console.error('Impossible de trouver les URLs des packages pour la distribution spécifiée.');
        process.exit(1);
    }

    const installedClient = isPackageInstalled('octez-client');
    const installedNode = isPackageInstalled('octez-node');

    const tmpClientPath = '/tmp/octez-client.deb';
    const tmpNodePath = '/tmp/octez-node.deb';

    try {
        if (!installedClient || installedClient.version !== clientPackageInfo.version) {
            console.log(`Téléchargement de octez-client...`);
            await downloadFile(clientPackageInfo.url, tmpClientPath);
            console.log(`Installation de octez-client...`);
            execSync(`sudo dpkg -i ${tmpClientPath}`);
        } else {
            console.log(`octez-client déjà installé. Version : ${installedClient.version}`);
        }

        if (!installedNode || installedNode.version !== nodePackageInfo.version) {
            console.log(`Téléchargement de octez-node...`);
            await downloadFile(nodePackageInfo.url, tmpNodePath);
            console.log(`Installation de octez-node...`);
            execSync(`sudo dpkg -i ${tmpNodePath}`);
        } else {
            console.log(`octez-node déjà installé. Version : ${installedNode.version}`);
        }
    } finally {
        // Supprimer les fichiers téléchargés
        if (fs.existsSync(tmpClientPath)) {
            fs.unlinkSync(tmpClientPath);
            console.log(`Fichier temporaire supprimé : ${tmpClientPath}`);
        }
        if (fs.existsSync(tmpNodePath)) {
            fs.unlinkSync(tmpNodePath);
            console.log(`Fichier temporaire supprimé : ${tmpNodePath}`);
        }
    }
}

module.exports = {
    getLatestPackageInfo,
    downloadFile,
    isPackageInstalled,
    installTezosTools
};
