const { execSync } = require('child_process');
const net = require('net');

function detectExistingNodes() {
    const nodes = [];

    console.log('Détection des nœuds Tezos existants en cours...');

    // Vérification des processus octez-node en cours d'exécution
    try {
        const output = execSync('pgrep -af octez-node').toString();
        const processes = output.split('\n').filter(line => line.includes('octez-node') && !line.includes('pgrep'));
        processes.forEach(process => {
            nodes.push(`Processus: ${process}`);
        });
    } catch (e) {
        // Aucun processus octez-node en cours d'exécution
    }

    return nodes;
}

function checkPortInUse(port) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();

        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(true);
            } else {
                reject(err);
            }
        });

        server.once('listening', () => {
            server.close();
            resolve(false);
        });

        server.listen(port);
    });
}

async function findAvailablePort(startPort = 8732, endPort = 8750) {
    for (let port = startPort; port <= endPort; port++) {
        const inUse = await checkPortInUse(port);
        if (!inUse) {
            return port;
        }
    }
    throw new Error(`No available ports found in range ${startPort}-${endPort}`);
}

module.exports = {
    detectExistingNodes,
    checkPortInUse,
    findAvailablePort
};
