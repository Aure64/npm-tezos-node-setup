const inquirer = require('inquirer');
const installTezosTools = require('../lib/packageManager').installTezosTools;
const { waitForIdentityFile, cleanNodeData, importSnapshot, getSnapshotSizes } = require('../lib/snapshotManager');
const { execSync, exec } = require('child_process');
const os = require('os');
const path = require('path');
const configureServiceUnit = require('../lib/serviceManager');
const { checkPortInUse, findAvailablePort, detectExistingNodes } = require('../lib/detect');
const fs = require('fs');
const sudo = require('sudo-prompt');

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
            console.log('Installation annulée par l\'utilisateur.');
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
        rpcPort = await inquirer.prompt([
            {
                type: 'input',
                name: 'rpcPort',
                message: 'Entrez le port RPC à utiliser (ou appuyez sur Entrée pour utiliser le port par défaut 8732):',
                default: '8732',
                validate: async (input) => {
                    const port = parseInt(input, 10);
                    if (isNaN(port)) {
                        return 'Veuillez entrer un numéro de port valide.';
                    }
                    const inUse = await checkPortInUse(port);
                    if (inUse) {
                        return `Le port ${port} est déjà utilisé. Veuillez en choisir un autre.`;
                    }
                    return true;
                }
            }
        ]);

        rpcPort = rpcPort.rpcPort;

        netPort = await inquirer.prompt([
            {
                type: 'input',
                name: 'netPort',
                message: 'Entrez le port réseau à utiliser (ou appuyez sur Entrée pour utiliser le port par défaut 9732):',
                default: '9732',
                validate: async (input) => {
                    const port = parseInt(input, 10);
                    if (isNaN(port)) {
                        return 'Veuillez entrer un numéro de port valide.';
                    }
                    const inUse = await checkPortInUse(port);
                    if (inUse) {
                        return `Le port ${port} est déjà utilisé. Veuillez en choisir un autre.`;
                    }
                    return true;
                }
            }
        ]);

        netPort = netPort.netPort;

        if (!(await checkPortInUse(rpcPort)) && !(await checkPortInUse(netPort))) {
            break;
        } else {
            console.log(`Les ports choisis (${rpcPort}, ${netPort}) sont déjà utilisés. Veuillez en choisir d'autres.`);
        }
    }

    let nodeName;
    let customPath;
    let dataDir;

    while (true) {
        const answers = await inquirer.prompt([
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

        nodeName = answers.nodeName;
        customPath = answers.customPath;
        dataDir = path.join(customPath, nodeName);

        if (fs.existsSync(dataDir)) {
            const { overwrite } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'overwrite',
                    message: `Le dossier ${dataDir} existe déjà. Voulez-vous le supprimer et réinstaller?`,
                    default: false
                }
            ]);

            if (overwrite) {
                fs.rmSync(dataDir, { recursive: true });
                console.log(`Le dossier ${dataDir} a été supprimé.`);
                fs.mkdirSync(dataDir, { recursive: true });
                break;
            } else {
                console.log(`Veuillez choisir un autre nom ou emplacement.`);
            }
        } else {
            fs.mkdirSync(dataDir, { recursive: true });
            break;
        }
    }

    const { snapshotMode } = await inquirer.prompt([
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

    const fastMode = snapshotMode === 'fast';

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

    const serviceName = `octez-node-${network}-${nodeName}`;
    configureServiceUnit(dataDir, rpcPort, netPort, serviceName);
    console.log('Installation terminée.');
}

main();
