const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE_DIR = os.homedir();

function detectExistingNodes() {
    const nodes = [];
    const basePath = path.join(BASE_DIR, '.tezos-node-setup');

    if (fs.existsSync(basePath)) {
        const files = fs.readdirSync(basePath);
        files.forEach(file => {
            if (file.startsWith('tezos-')) {
                nodes.push(file);
            }
        });
    }
    return nodes;
}

module.exports = detectExistingNodes;
