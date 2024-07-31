const inquirer = require('inquirer');
const installTezosTools = require('../lib/packageManager').installTezosTools;
const { waitForIdentityFile, cleanNodeData, importSnapshot, getSnapshotSizes, cleanNodeDataBeforeImport } = require('../lib/snapshotManager');
const { exec, execSync } = require('child_process');
const os = require('os');
const path = require('path');
const configureServiceUnit = require('../lib/serviceManager');
const { checkPortInUse, detectExistingNodes } = require('../lib/detect');
const fs = require('fs');
const downloadFile = require('../lib/downloadFile');

const BASE_DIR = os.homedir();

async function main() {
    console.log('Téléchargement et installation de octez-client et octez-node...');
    await installTezosTools();

    console.log('Détection des nœuds Tezos existants en cours...');
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
            default: `${network}-node`
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

    const dataDir = path.join(customPath, nodeName);
    const fastMode = snapshotMode === 'fast';

    if (fs.existsSync(dataDir)) {
        console.log(`Le dossier ${dataDir} existe déjà.`);
        const { removeExisting } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'removeExisting',
                message: 'Voulez-vous supprimer le dossier existant et continuer?',
                default: false
            }
        ]);

        if (removeExisting) {
            fs.rmSync(dataDir, { recursive: true, force: true });
            console.log(`Le dossier ${dataDir} a été supprimé.`);
        } else {
            console.log('Installation annulée.');
            process.exit(0);
        }
    }

    fs.mkdirSync(dataDir, { recursive: true });

    while (true) {
        try {
            console.log(`Initialisation du noeud...`);
            execSync(`octez-node config init --data-dir "${dataDir}" --network=${network} --history-mode=${mode}`);
            console.log(`Lancement du noeud pour création de l'identité...`);
            const nodeProcess = exec(`octez-node run --data-dir "${dataDir}"`);

            try {
                await waitForIdentityFile(dataDir);
                console.log('Identité créée, arrêt du noeud...');
                nodeProcess.kill('SIGINT');
                break;
            } catch (error) {
                console.error(error.message);
                console.log('Nettoyage des données du nœud...');
                cleanNodeData(dataDir);
                console.log('Réinitialisation...');
            }
        } catch (error) {
            console.error(`Erreur lors de l'initialisation du noeud: ${error.message}`);
            process.exit(1);
        }
    }

    const snapshotPath = '/tmp/snapshot';

    while (true) {
        try {
            console.log(`Téléchargement du snapshot depuis https://snapshots.eu.tzinit.org/${network}/${mode}...`);
            await downloadFile(`https://snapshots.eu.tzinit.org/${network}/${mode}`, snapshotPath);
            break;
        } catch (error) {
            console.error(`Erreur lors du téléchargement du snapshot: ${error.message}`);
        }
    }

    while (true) {
        try {
            console.log('Nettoyage des fichiers avant importation du snapshot...');
            cleanNodeDataBeforeImport(dataDir);
            await importSnapshot(network, mode, dataDir, fastMode, snapshotPath);
            fs.unlinkSync(snapshotPath);
            break;
        } catch (error) {
            console.error(`Erreur lors de l'importation du snapshot: ${error.message}`);
            console.log('Tentative de nettoyage et nouvelle importation du snapshot...');
            cleanNodeData(dataDir);
        }
    }

    console.log('Configuration du service systemd...');
    try {
        await configureServiceUnit(dataDir, rpcPort, netPort, `octez-node-${network}-${nodeName}`);
    } catch (error) {
        console.error(`Erreur lors de la configuration du service systemd: ${error.message}`);
        process.exit(1);
    }

    console.log('Installation terminée.');
}

main();
