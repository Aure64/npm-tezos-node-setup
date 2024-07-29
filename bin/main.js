const inquirer = require('inquirer');
const getOS = require('../lib/getOS');
const packageManager = require('../lib/packageManager');
const snapshotManager = require('../lib/snapshotManager');
const serviceManager = require('../lib/serviceManager');
const { execSync, exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const BASE_DATA_DIR = path.join(os.homedir(), '.tezos-node-setup');

function getNextAvailableDataDir(network) {
    let index = 1;
    let dataDir;
    do {
        dataDir = `${BASE_DATA_DIR}-${network}-${index}`;
        index++;
    } while (fs.existsSync(dataDir));
    return dataDir;
}

async function main() {
    const { distro } = await getOS();

    await packageManager.installTezosTools(distro);

    const networks = ['mainnet', 'ghostnet'];
    const { network } = await inquirer.prompt([
        {
            type: 'list',
            name: 'network',
            message: 'Choisissez le réseau:',
            choices: networks
        }
    ]);

    const snapshotSizes = await snapshotManager.getSnapshotSizes(network);
    const { mode } = await inquirer.prompt([
        {
            type: 'list',
            name: 'mode',
            message: 'Choisissez le mode:',
            choices: Object.keys(snapshotSizes).map(key => ({
                name: `${key} (${snapshotSizes[key]} GB)`,
                value: key
            }))
        }
    ]);

    const portChoices = await inquirer.prompt([
        {
            type: 'input',
            name: 'rpcPort',
            message: 'Entrez le port RPC à utiliser (ou appuyez sur Entrée pour utiliser le port par défaut 8732):',
            default: 8732,
            validate: function (value) {
                const valid = !isNaN(parseFloat(value)) && isFinite(value);
                return valid || 'Veuillez entrer un numéro de port valide';
            }
        },
        {
            type: 'input',
            name: 'netPort',
            message: 'Entrez le port réseau à utiliser (ou appuyez sur Entrée pour utiliser le port par défaut 9732):',
            default: 9732,
            validate: function (value) {
                const valid = !isNaN(parseFloat(value)) && isFinite(value);
                return valid || 'Veuillez entrer un numéro de port valide';
            }
        }
    ]);

    const rpcPort = portChoices.rpcPort;
    const netPort = portChoices.netPort;
    console.log(`Ports choisis - RPC: ${rpcPort}, Réseau: ${netPort}`);

    const importChoice = await inquirer.prompt([
        {
            type: 'list',
            name: 'importMode',
            message: 'Choisissez le mode d\'importation du snapshot:',
            choices: [
                { name: 'Safe mode (recommended)', value: 'safe' },
                { name: 'Fast mode', value: 'fast' }
            ]
        }
    ]);

    const importMode = importChoice.importMode;

    const dataDir = getNextAvailableDataDir(network);
    console.log(`Répertoire de données choisi : ${dataDir}`);

    console.log(`Initialisation du noeud...`);
    execSync(`octez-node config init --data-dir ${dataDir} --network=${network} --history-mode=${mode}`);
    console.log(`Lancement du noeud pour création de l'identité...`);
    const nodeProcess = exec(`octez-node run --data-dir ${dataDir}`);

    try {
        await snapshotManager.waitForIdentityFile(dataDir);
        console.log('Identité créée, arrêt du noeud...');
        nodeProcess.kill('SIGINT');
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }

    console.log('Arrêt du noeud...');
    execSync(`sudo systemctl stop octez-node`);

    try {
        snapshotManager.cleanNodeData(dataDir);
        await snapshotManager.importSnapshot(network, mode, dataDir, importMode === 'fast');
    } catch (error) {
        console.error('Erreur lors de l\'importation du snapshot:', error);
        process.exit(1);
    }

    serviceManager.configureServiceUnit(dataDir, rpcPort, netPort);
    console.log('Installation terminée.');
}

main();
