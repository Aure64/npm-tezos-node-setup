const { installTezosTools } = require('../lib/packageManager');

async function test() {
    try {
        await installTezosTools();
        console.log('Test terminé avec succès.');
    } catch (error) {
        console.error('Erreur lors du test :', error);
    }
}

test();
