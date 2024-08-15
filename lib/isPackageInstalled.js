const { execSync } = require('child_process');

function isPackageInstalled(packageName) {
    try {
        const output = execSync(`dpkg -l | grep ${packageName}`).toString();
        const match = output.match(/^ii\s+(\S+)\s+(\S+)/);
        if (match) {
            return { name: match[1], version: match[2] };
        }
    } catch (e) {
        return null;
    }
    return null;
}

module.exports = isPackageInstalled;
