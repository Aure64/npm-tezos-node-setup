# Tezos Node Setup

## Description

Ce projet permet d'automatiser l'installation et la configuration d'un nœud Tezos sur une machine Linux. Il gère le téléchargement et l'installation des packages nécessaires, configure le nœud Tezos, et permet d'importer des snapshots pour synchroniser rapidement la blockchain.

## Fonctionnalités

- Détection automatique de la distribution Linux (Ubuntu, Debian, etc.).
- Téléchargement et installation des derniers packages `octez-client` et `octez-node`.
- Configuration personnalisée du nœud Tezos avec choix du réseau (mainnet, ghostnet, etc.) et du mode d'historique (full, rolling).
- Importation de snapshots avec option de mode rapide ou sécurisé.
- Configuration du service systemd pour gérer le nœud Tezos en arrière-plan.
- Possibilité de lancer plusieurs nœuds sur la même machine avec des configurations distinctes.

## Prérequis

- Node.js (version 14 ou supérieure)
- NPM (Node Package Manager)
- Git
- Accès sudo pour installer des packages et configurer des services systemd

## Installation

1. Clonez ce dépôt Git sur votre machine locale :

    ```bash
    git clone https://github.com/Aure64/npm-tezos-node-setup.git
    cd npm-tezos-node-setup
    ```

2. Installez les dépendances du projet :

    ```bash
    npm install
    ```

## Utilisation

Pour lancer le script principal et configurer un nœud Tezos, exécutez :

```bash
node bin/main.js
```

