async function getLatestBinariesPackageInfo(arch) {
    try {
        const response = await axios.get(`${GITLAB_API_URL}/${PROJECT_ID}/packages`, {
            params: {
                order_by: 'created_at',
                sort: 'desc',
                per_page: 10
            }
        });

        console.log('Packages found:');
        response.data.forEach(pkg => {
            console.log(`Package name: ${pkg.name}, version: ${pkg.version}`);
        });

        const binariesPackage = response.data.find(pkg =>
            pkg.name.includes('octez-binaries') &&
            !pkg.name.includes('beta') &&
            pkg.name.includes(arch)
        );

        if (!binariesPackage) {
            console.error(`No binaries package found for architecture ${arch}`);
            return null;
        }

        console.log(`Selected package: ${binariesPackage.name}, version: ${binariesPackage.version}`);

        const packageFilesResponse = await axios.get(`${GITLAB_API_URL}/${PROJECT_ID}/packages/${binariesPackage.id}/package_files`);

        console.log('Package files found:');
        packageFilesResponse.data.forEach(file => {
            console.log(`File name: ${file.file_name}, download URL: ${file.url}`);
        });

        const packageFile = packageFilesResponse.data.find(file => file.file_name.includes(arch));
        if (!packageFile) {
            console.error(`No package file found for architecture ${arch}`);
            return null;
        }

        console.log(`Selected file: ${packageFile.file_name}, download URL: ${packageFile.url}`);

        return {
            version: binariesPackage.version,
            url: `https://gitlab.com/tezos/tezos/-/package_files/${packageFile.id}/download`
        };
    } catch (error) {
        console.error(`Error retrieving latest binaries package URL for architecture ${arch}:`, error.message);
        return null;
    }
}
