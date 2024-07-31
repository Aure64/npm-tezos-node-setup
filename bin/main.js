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
            execSync(`sudo rm -rf ${dataDir}`);
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
            const nodeProcess = exec(`octez-node run --data-dir "${dataDir}" --net-addr 0.0.0.0:${netPort}`);

            try {
                await waitForIdentityFile(dataDir);
                console.log('Identité créée, arrêt du noeud...');
                nodeProcess.kill('SIGINT');
                await new Promise(resolve => setTimeout(resolve, 5000)); // Attente pour s'assurer que le processus est bien arrêté
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

    // Assurez-vous que le processus est bien arrêté avant de continuer
    try {
        console.log(`Vérification et arrêt des processus utilisant le port ${netPort}...`);
        const processesUsingNetPort = execSync(`lsof -i :${netPort}`).toString().split('\n').filter(line => line.includes('octez-nod'));
        processesUsingNetPort.forEach(line => {
            const pid = line.split(/\s+/)[1];
            execSync(`sudo kill ${pid}`);
            console.log(`Arrêt du processus utilisant le port ${netPort}: ${pid}`);
        });
    } catch (e) {
        // Pas de processus utilisant ce port
        console.log(`Aucun processus utilisant le port ${netPort} trouvé.`);
    }

    console.log('Configuration du service systemd...');
    try {
        const serviceName = `octez-node-${nodeName}`;
        configureServiceUnit(dataDir, rpcPort, netPort, serviceName);
        console.log('Service systemd configuré avec succès.');
    } catch (error) {
        console.error(`Erreur lors de la configuration du service systemd: ${error.message}`);
        process.exit(1);
    }

    // Vérification du statut du service
    try {
        const serviceStatus = execSync(`sudo systemctl is-active octez-node-${nodeName}`);
        if (serviceStatus.toString().trim() !== 'active') {
            throw new Error('Le service n\'a pas démarré correctement');
        }
        console.log(`Le service octez-node-${nodeName} a démarré avec succès.`);
    } catch (error) {
        console.error(`Erreur lors du démarrage du service: ${error.message}`);
        process.exit(1);
    }

    console.log('Installation terminée.');
    process.exit(0);
}

main();
