const { execSync } = require('child_process');
const fs = require('fs');

// Function to detect the operating system and its version
async function getOS() {
    const platform = process.platform; // Determine the platform (e.g., 'linux', 'win32', 'darwin')
    let distro = '';  // Initialize the distribution variable
    let version = ''; // Initialize the version variable

    if (platform === 'linux') {
        try {
            // Try using lsb_release to get distro and version
            if (commandExists('lsb_release')) {
                distro = execSync('lsb_release -cs').toString().trim().toLowerCase();
                version = execSync('lsb_release -r -s').toString().trim();
            } else if (fs.existsSync('/etc/os-release')) {
                // Fallback to /etc/os-release
                const osRelease = parseOSReleaseFile('/etc/os-release');
                distro = osRelease.ID || 'unknown';
                version = osRelease.VERSION_ID || 'unknown';
            } else if (fs.existsSync('/etc/*-release')) {
                // Fallback to generic release files
                const genericRelease = parseOSReleaseFile('/etc/*-release');
                distro = genericRelease.ID || 'unknown';
                version = genericRelease.VERSION_ID || 'unknown';
            } else {
                throw new Error('Unable to detect the Linux distribution.');
            }

            console.log(`Distro: ${distro}, Version: ${version}`);
        } catch (e) {
            console.error(`Error detecting Linux distribution: ${e.message}`);
            process.exit(1);
        }
    } else {
        console.error('Unsupported operating system.');
        process.exit(1);
    }

    return { platform, distro, version };
}

// Helper function to check if a command exists
function commandExists(command) {
    try {
        execSync(`command -v ${command}`);
        return true;
    } catch (e) {
        return false;
    }
}

// Helper function to parse /etc/os-release or other *-release files
function parseOSReleaseFile(filePath) {
    const osReleaseContent = fs.readFileSync(filePath, 'utf8');
    const osInfo = {};
    osReleaseContent.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
            osInfo[key.trim()] = value.trim().replace(/^"|"$/g, ''); // Remove any surrounding quotes
        }
    });
    return osInfo;
}

module.exports = getOS;
