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
                console.log(`Port ${port} utilisé par un nœud Tezos.`);
                nodes.push(`octez-node utilisant le port ${port}`);
            } else {
                console.log(`Port ${port} non utilisé par un nœud Tezos.`);
            }
        } catch (e) {
            console.log(`Port ${port} non utilisé.`);
        }
    });

    // Vérification des processus octez-node en cours d'exécution
    try {
        const output = execSync('pgrep -af octez-node').toString();
        const processes = output.split('\n').filter(line => line.includes('octez-node'));
        processes.forEach(process => {
            console.log(`Processus détecté : ${process}`);
            nodes.push(`Processus: ${process}`);
        });
    } catch (e) {
        console.log('Aucun processus octez-node en cours d\'exécution.');
    }

    console.log('Nœuds détectés :', nodes.length ? nodes : 'Aucun nœud trouvé.');
    return nodes;
}

module.exports = detectExistingNodes;
