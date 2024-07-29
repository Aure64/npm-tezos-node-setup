const { execSync } = require('child_process');

function isPackageInstalled(packageName) {
    console.log(`Vérification si le package ${packageName} est installé...`);
    try {
        const output = execSync(`dpkg -l | grep ${packageName}`).toString();
        const match = output.match(/^ii\s+(\S+)\s+(\S+)/);
        if (match) {
            console.log(`Package trouvé : ${match[1]}, Version : ${match[2]}`);
            return { name: match[1], version: match[2] };
        }
    } catch (e) {
        console.log(`Package ${packageName} non trouvé.`);
        return null;
    }
    return null;
}

module.exports = isPackageInstalled;
