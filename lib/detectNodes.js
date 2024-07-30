const { execSync } = require('child_process');

function detectExistingNodes() {
    const ports = [8732, 9732];
    const nodes = [];

    console.log('Détection des nœuds Tezos existants en cours...');

    // Vérification des ports utilisés
    ports.forEach(port => {
        try {
            const output = execSync(`lsof -i :${port}`).toString();
            if (output.includes('octez-node')) {
                nodes.push(`octez-node utilisant le port ${port}`);
            }
        } catch (e) {
            // Port non utilisé, pas d'action nécessaire
        }
    });

    // Vérification des processus octez-node en cours d'exécution
    try {
        const output = execSync('pgrep -af octez-node').toString();
        const processes = output.split('\n').filter(line => line.includes('octez-node'));
        processes.forEach(process => {
            nodes.push(`Processus: ${process}`);
        });
    } catch (e) {
        // Aucun processus octez-node en cours d'exécution
    }

    return nodes;
}

module.exports = detectExistingNodes;
