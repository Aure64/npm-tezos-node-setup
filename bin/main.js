const inquirer = require('inquirer');
const installTezosTools = require('../lib/packageManager').installTezosTools;
const { waitForIdentityFile, cleanNodeData, importSnapshot, getSnapshotSizes } = require('../lib/snapshotManager');
const { execSync, exec } = require('child_process');
const os = require('os');
const path = require('path');
const configureServiceUnit = require('../lib/serviceManager');
const { checkPortInUse, detectExistingNodes } = require('../lib/detect');
const fs = require('fs');
const sudo = require('sudo-prompt');
const downloadFile = require('../lib/downloadFile');

const BASE_DIR = os.homedir();

async function main() {
    console.log('Téléchargement et installation de octez-client et octez-node...');
    await installTezosTools();

    const existingNodes = detectExistingNodes();
    if (existingNodes.length > 0) {
        console.log('Nœuds Tezos existants :');
        existingNodes.forEach(node => console.log(`- ${node}`));

        const { continueInstallation } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'continueInstallation',
                message: 'Des nœuds Tezos sont déjà en cours d\'exécution. Voulez-vous continuer l\'installation d\'un nouveau nœud?',
                default: false
            }
        ]);

        if (!continueInstallation) {
            console.log('Installation annulée.');
            process.exit(0);
        }
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

    let rpcPort;
    let netPort;

    while (true) {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'rpcPort',
                message: 'Entrez le port RPC à utiliser (ou appuyez sur Entrée pour utiliser le port par défaut 8732):',
                default: '8732'
            },
            {
                type: 'input',
                name: 'netPort',
                message: 'Entrez le port réseau à utiliser (ou appuyez sur Entrée pour utiliser le port par défaut 9732):',
                default: '9732'
            }
        ]);

        const rpcPortInUse = await checkPortInUse(answers.rpcPort);
        const netPortInUse = await checkPortInUse(answers.netPort);

        if (rpcPortInUse) {
            console.log(`Le port RPC ${answers.rpcPort} est déjà utilisé. Veuillez choisir un autre port.`);
        } else if (netPortInUse) {
            console.log(`Le port réseau ${answers.netPort} est déjà utilisé. Veuillez choisir un autre port.`);
        } else {
            rpcPort = answers.rpcPort;
            netPort = answers.netPort;
            break;
        }
    }

    const { nodeName, customPath, snapshotMode } = await inquirer.prompt([
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
        },
        {
            type: 'list',
            name: 'snapshotMode',
            message: 'Choisissez le mode d\'importation du snapshot:',
            choices: [
                { name: 'Safe mode', value: 'safe' },
                { name: 'Fast mode', value: 'fast' }
            ]
        }
    ]);

    const dataDir = path.join(customPath, nodeName === `.${network}-node` ? nodeName : `.${nodeName}`);
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
        cleanNodeData(dataDir);
        console.log('Le dossier de données a été nettoyé. Réinitialisation...');
        execSync(`octez-node config init --data-dir ${dataDir} --network=${network} --history-mode=${mode}`);
        const nodeProcessRetry = exec(`octez-node run --data-dir ${dataDir}`);
        try {
            await waitForIdentityFile(dataDir);
            console.log('Identité créée lors de la réinitialisation, arrêt du noeud...');
            nodeProcessRetry.kill('SIGINT');
        } catch (retryError) {
            console.error(retryError.message);
            process.exit(1);
        }
    }

    console.log('Arrêt du noeud...');
    execSync(`sudo systemctl stop octez-node`);

    try {
        cleanNodeData(dataDir);
        await importSnapshot(network, mode, dataDir, fastMode);
    } catch (error) {
        console.error('Erreur lors de l\'importation du snapshot:', error);
        console.log('Tentative de nettoyage et nouvelle importation du snapshot...');
        cleanNodeData(dataDir);
        try {
            await importSnapshot(network, mode, dataDir, fastMode);
        } catch (retryError) {
            console.error('Nouvelle erreur lors de l\'importation du snapshot:', retryError);
            process.exit(1);
        }
    }

    configureServiceUnit(dataDir, rpcPort, netPort);
    console.log('Installation terminée.');
}

main();
