const { execSync } = require('child_process');
const net = require('net');

// Function to detect existing Tezos nodes running on the system
function detectExistingNodes() {
    const nodes = [];

    try {
        // Execute the command to find all processes related to 'octez-node'
        const output = execSync('pgrep -af octez-node').toString();
        // Filter the processes to only include those running with 'octez-node run'
        const processes = output.split('\n').filter(line => line.includes('octez-node run'));
        // Add each detected process to the nodes array
        processes.forEach(process => {
            nodes.push(`Process: ${process}`);
        });
    } catch (e) {
        // Handle any errors (e.g., if no processes are found)
        // No need to log here since it's expected that no nodes may be running
    }

    return nodes;  // Return the list of detected nodes
}

// Function to check if a specific port is currently in use
function checkPortInUse(port) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();  // Create a new server to check the port

        // If there's an error and the port is in use, resolve with true
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(true);  // Port is in use
            } else {
                reject(err);  // Some other error occurred
            }
        });

        // If the server starts listening, the port is not in use
        server.once('listening', () => {
            server.close();  // Close the server
            resolve(false);  // Port is not in use
        });

        server.listen(port);  // Try to listen on the specified port
    });
}

module.exports = {
    detectExistingNodes,
    checkPortInUse
};
