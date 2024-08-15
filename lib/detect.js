const { execSync } = require('child_process');
const net = require('net');

function detectExistingNodes() {
    const nodes = [];

    try {
        const output = execSync('pgrep -af octez-node').toString();
        const processes = output.split('\n').filter(line => line.includes('octez-node') && !line.includes('pgrep'));
        processes.forEach(process => {
            nodes.push(`Processus: ${process}`);
        });
    } catch (e) {
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

module.exports = {
    detectExistingNodes,
    checkPortInUse
};
