const { execSync } = require('child_process');

// Function to detect the operating system and its version
async function getOS() {
    const platform = process.platform;  // Determine the platform (e.g., 'linux', 'win32', 'darwin')
    let distro = '';  // Initialize the distribution variable
    let version = ''; // Initialize the version variable


    if (platform === 'linux') {
        try {
            // Get the distribution name (e.g., 'ubuntu', 'debian')
            distro = execSync('lsb_release -cs').toString().trim().toLowerCase();
            // Get the distribution version (e.g., '20.04', '10')
            version = execSync('lsb_release -r -s').toString().trim();
            console.log(`Distro: ${distro}, Version: ${version}`);
        } catch (e) {
            // If there's an error, print a message and exit the process
            console.error('Unable to detect the Linux distribution.');
            process.exit(1);
        }
    } else {
        // If the platform is not Linux, print a message and exit the process
        console.error('Unsupported operating system.');
        process.exit(1);
    }

    // Return the detected platform, distribution, and version
    return { platform, distro, version };
}

module.exports = getOS;
