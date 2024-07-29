const { execSync } = require('child_process');

async function getOS() {
    const platform = process.platform;
    let distro = '';
    let version = '';

    if (platform === 'linux') {
        try {
            distro = execSync('lsb_release -cs').toString().trim().toLowerCase();
            version = execSync('lsb_release -r -s').toString().trim();
            console.log(`Distro: ${distro}, Version: ${version}`);
        } catch (e) {
            console.error('Impossible de détecter la distribution Linux.');
            process.exit(1);
        }
    } else {
        console.error('Système d\'exploitation non supporté.');
        process.exit(1);
    }

    return { platform, distro, version };
}

module.exports = getOS;
