const net = require('net');

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
    checkPortInUse,
    findAvailablePort
};
