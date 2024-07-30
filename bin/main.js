const inquirer = require('inquirer');
const installTezosTools = require('../lib/packageManager').installTezosTools;
const detectExistingNodes = require('../lib/detectNodes');
const { waitForIdentityFile, cleanNodeData, importSnapshot, getSnapshotSizes } = require('../lib/snapshotManager');
const { execSync, exec } = require('child_process');
const os = require('os');
const path = require('path');
const configureServiceUnit = require('../lib/serviceManager');
const fs = require('fs');
const { checkPortInUse, findAvailablePort } = require('../lib/detectPorts');

const BASE_DIR = os.homedir();

async function main() {
    // Installation des outils Tezos
    await installTezosTools();

    const existingNodes = detectExistingNodes();
    if (existingNodes.length > 0) {
        console.log('Nœuds Tezos existants :');
        existingNodes.forEach(node => console.log(`- ${node}`));
    } else {
        console.log('Aucun nœud Tezos existant trouvé.');
    }

    const { network } = await inquirer.prompt([
        {
            type: 'list',
            name: 'network',
            message: 'Choisissez le réseau:',
            choices: ['mainnet', 'ghostnet']
        }
    ]);

    const snapshotSizes = await getSnapshotSizes(network);

    const { mode } = await inquirer.prompt([
        {
            type: 'list',
            name: 'mode',
            message: 'Choisissez le mode:',
            choices: [
                { name: `full (${snapshotSizes.full} GB)`, value: 'full' },
                { name: `rolling (${snapshotSizes.rolling} GB)`, value: 'rolling' }
            ]
        }
    ]);

    // Trouver les ports disponibles
    const defaultRpcPort = await findAvailablePort(8732, 8750);
    const defaultNetPort = await findAvailablePort(9732, 9750);

    const { rpcPort, netPort, snapshotMode, nodeName, customPath } = await inquirer.prompt([
        {
            type: 'input',
            name: 'rpcPort',
            message: `Entrez le port RPC à utiliser (ou appuyez sur Entrée pour utiliser le port par défaut ${defaultRpcPort}):`,
            default: defaultRpcPort
        },
        {
            type: 'input',
            name: 'netPort',
            message: `Entrez le port réseau à utiliser (ou appuyez sur Entrée pour utiliser le port par défaut ${defaultNetPort}):`,
            default: defaultNetPort
        },
        {
            type: 'list',
            name: 'snapshotMode',
            message: 'Choisissez le mode d\'importation du snapshot:',
            choices: [
                { name: 'Safe mode', value: 'safe' },
                { name: 'Fast mode', value: 'fast' }
            ]
        },
        {
            type: 'input',
            name: 'nodeName',
            message: 'Voulez-vous personnaliser le nom du nœud? (laisser vide pour le nom par défaut):',
            default: `.${network}-node`
        },
        {
            type: 'input',
            name: 'customPath',
            message: 'Voulez-vous personnaliser l\'emplacement du nœud? (laisser vide pour l\'emplacement par défaut):',
            default: BASE_DIR
        }
    ]);

    // Vérifier si les ports sont disponibles
    const isRpcPortInUse = await checkPortInUse(rpcPort);
    const isNetPortInUse = await checkPortInUse(netPort);

    if (isRpcPortInUse || isNetPortInUse) {
        console.log(`Le port RPC ${rpcPort} ou le port réseau ${netPort} est déjà utilisé. Veuillez choisir d'autres ports.`);
        process.exit(1);
    }

    const dataDir = path.join(customPath, nodeName === `.${network}-node` ? nodeName : nodeName);
    const fastMode = snapshotMode === 'fast';

    if (fs.existsSync(dataDir)) {
        console.log(`Le dossier ${dataDir} existe déjà. Veuillez choisir un autre nom.`);
        process.exit(1);
    }

    fs.mkdirSync(dataDir, { recursive: true });

    console.log(`Initialisation du noeud...`);
    execSync(`octez-node config init --data-dir ${dataDir} --network=${network} --history-mode=${mode}`);
    console.log(`Lancement du noeud pour création de l'identité...`);
    const nodeProcess = exec(`octez-node run --data-dir ${dataDir}`);

    try {
        await waitForIdentityFile(dataDir);
        console.log('Identité créée, arrêt du noeud...');
        nodeProcess.kill('SIGINT');
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }

    console.log('Arrêt du noeud...');
    execSync(`sudo systemctl stop octez-node`);

    try {
        cleanNodeData(dataDir);
        await importSnapshot(network, mode, dataDir, fastMode);
    } catch (error) {
        console.error('Erreur lors de l\'importation du snapshot:', error);
        process.exit(1);
    }

    configureServiceUnit(dataDir, rpcPort, netPort);
    console.log('Installation terminée.');
}

main();
