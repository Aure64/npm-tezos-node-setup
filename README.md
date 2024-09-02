# Tezos Node Setup

## Description

This project automates the installation and configuration of a Tezos node on a Linux machine. It manages the download and installation of the necessary packages, configures the Tezos node, allows snapshots to be imported to quickly synchronise the blockchain, offers simplified configuration for the baking service and monitoring.

## Features

- **Automatic Linux distribution detection**: Supports Ubuntu, Debian, and other Debian-based distributions.
- **Download and installation of the latest packages**: `octez-client`, `octez-node`, and `octez-baker`, with support for different architectures (x86_64, arm64).
- **Customised configuration of the Tezos node** :
  - Choice of network (mainnet, ghostnet, etc.).
  - Configurable history mode (full, rolling).
- **Snapshot import**: Fast blockchain synchronisation with fast or secure mode options.
- **systemd service configuration** :
  - Node management in the background with `systemd`.
  - Support for multiple nodes on the same machine with separate configurations.
  - Automatic service restart for improved reliability.
- **Baker Tezos configuration** :
  - Import of existing keys or generation of new keys.
  - Possibility of connecting a Ledger or importing a secret key.
  - Baking fund management with faucet integration on test networks.
- **Monitoring with pyrometer** :
  - Launch Pyrometer service.
  - Add the baker address + the alias on the dasbhoard UI
  - Monitor the node too



## Prerequisites

- **NodeJS **: Version 16 or higher. (NVM setup needed)
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash  
source ~/.bashrc    
nvm install --lts 
```                                                                     
- **NPM**: Node Package Manager (available already with NVM).
- **Git**: To clone the repository.
- **User with sudo access**: Required to install packages and configure `systemd` services.
```bash
sudo useradd -m -s /bin/bash tezos
sudo passwd tezos
sudo usermod -aG sudo tezos
su - tezos
```


## Installation

1. Clone this Git repository on your local machine:

    ```bash
    git clone https://github.com/Aure64/npm-tezos-node-setup.git
    cd npm-tezos-node-setup
    ```

2. Install the project dependencies and start the script :

    ```bash
    npm install
    ```

## Usage

To run the main script and configure a Tezos node, run :

```bash
npm start
```

### Installation process

1. **Detection of existing nodes** : The script detects Tezos nodes already present on the machine.
2. **Node configuration**:
   - Selection of the Tezos network.
   - Choice of history mode (full or rolling).
   - Configure RPC and P2P ports.
   - Import a snapshot for rapid synchronisation.
3. **Bootstrap monitoring** : The script monitors the state of the node until it is fully synchronised with the network.
4. **Baker configuration** (optional) :
   - Import or generate keys.
   - Configuration of the `systemd` service for the Baker.
   - Manage the funds required for baking.
5. **Baker monitoring** : The script monitors the state of the node and the baker on an web interface.

### Notes

- If a node is already running, the script will prompt you to configure a Baker on that node.
- Sometimes, the identity is not created directly, just wait and it will be created.
- If a port conflict is detected, the script will ask you to choose another available port.
- The script includes automatic restart mechanisms to ensure that the Tezos node is properly launched and running in the background.

## Contributions

Contributions are welcome! To report a bug or suggest an improvement, please open an issue or submit a pull request on the GitHub repository.

## License

This project is licensed under the MIT license. 

Translated with DeepL.com (free version)