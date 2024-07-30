const { execSync } = require('child_process');

function detectExistingNodes() {
    const ports = [8732, 9732];
    const nodes = [];

    ports.forEach(port => {
        try {
            const output = execSync(`lsof -i :${port}`).toString();
            if (output.includes('octez-node')) {
                nodes.push(`octez-node using port ${port}`);
            }
        } catch (e) {
            // Port is not in use
        }
    });

    try {
        const output = execSync('pgrep -af octez-node').toString();
        const processes = output.split('\n').filter(line => line.includes('octez-node'));
        processes.forEach(process => {
            nodes.push(`Process: ${process}`);
        });
    } catch (e) {
        // No octez-node processes running
    }

    return nodes;
}

module.exports = detectExistingNodes;
