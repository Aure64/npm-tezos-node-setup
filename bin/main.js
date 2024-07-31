const inquirer = require('inquirer');
const installTezosTools = require('../lib/packageManager').installTezosTools;
const detectExistingNodes = require('../lib/detectNodes');
const { waitForIdentityFile, cleanNodeData, cleanNodeDataBeforeImport, importSnapshot, getSnapshotSizes } = require('../lib/snapshotManager');
const { execSync, exec } = require('child_process');
const os = require('os');
const path = require('path');
const configureServiceUnit = require('../lib/serviceManager');
const fs = require('fs');

const BASE_DIR = os.homedir();

async function main() {
    // Installation des outils Tezos
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

    const { rpcPort, netPort, snapshotMode, nodeName, customPath } = await inquirer.prompt([
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
            default: `${network}-node`
        },
        {
            type: 'input',
            name: 'customPath',
            message: 'Voulez-vous personnaliser l\'emplacement du nœud? (laisser vide pour l\'emplacement par défaut):',
            default: BASE_DIR
        }
    ]);

    const dataDir = path.join(customPath, nodeName === `${network}-node` ? `${nodeName}` : nodeName);
    const fastMode = snapshotMode === 'fast';

    if (fs.existsSync(dataDir)) {
        console.log(`Le dossier ${dataDir} existe déjà.`);
        const { overwrite } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'overwrite',
                message: 'Voulez-vous supprimer le dossier existant et continuer?',
                default: false
            }
        ]);
        if (overwrite) {
            execSync(`sudo rm -rf ${dataDir}`);
        } else {
            process.exit(0);
        }
    }

    fs.mkdirSync(dataDir, { recursive: true });

    async function initializeNode() {
        try {
            console.log('Initialisation du noeud...');
            execSync(`octez-node config init --data-dir "${dataDir}" --network=${network} --history-mode=${mode}`);
            console.log(`Lancement du noeud pour création de l'identité...`);
            const nodeProcess = exec(`octez-node run --data-dir ${dataDir}`);

            await waitForIdentityFile(dataDir);
            console.log('Identité créée, arrêt du noeud...');
            nodeProcess.kill('SIGINT');
        } catch (error) {
            console.error(`Erreur lors de l'initialisation du noeud : ${error.message}`);
            cleanNodeData(dataDir);
            initializeNode();
        }
    }

    await initializeNode();

    const snapshotPath = path.join('/tmp', 'snapshot');
    if (!fs.existsSync(snapshotPath)) {
        console.log(`Téléchargement du snapshot depuis https://snapshots.eu.tzinit.org/${network}/${mode}...`);
        await downloadFile(`https://snapshots.eu.tzinit.org/${network}/${mode}`, snapshotPath);
        console.log(`Téléchargement terminé : ${snapshotPath}`);
    }

    async function handleSnapshotImport() {
        try {
            cleanNodeDataBeforeImport(dataDir);
            await importSnapshot(network, mode, dataDir, fastMode, snapshotPath);
            console.log(`Importation réussie du snapshot : ${snapshotPath}`);
            fs.unlinkSync(snapshotPath);
        } catch (error) {
            console.error(`Erreur lors de l'importation du snapshot: ${error.message}`);
            cleanNodeData(dataDir);
            initializeNode();
            handleSnapshotImport();
        }
    }

    await handleSnapshotImport();

    console.log('Configuration du service systemd...');
    try {
        configureServiceUnit(dataDir, rpcPort, netPort, nodeName);
        execSync(`sudo systemctl enable ${nodeName}`);
        execSync(`sudo systemctl start ${nodeName}`);
        console.log('Service systemd configuré avec succès.');
    } catch (error) {
        console.error(`Erreur lors de la configuration du service systemd: ${error.message}`);
    }

    console.log('Installation terminée.');
    process.exit(0);
}

main();
