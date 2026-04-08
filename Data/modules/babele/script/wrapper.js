
/**
 * Since foundry 0.8.+, translations are directly applied replacing the default ClientDatabaseBackend _getDocuments implementation
 * with a code that merge the incoming data with the mapped translations using LibWrapper.
 */
export function initWrapper() {

    if(!game.modules.get('lib-wrapper')?.active && game.user.isGM) {
        ui.notifications.error(game.i18n.localize("BABELE.requireLibWrapperMessage"));
    }

    libWrapper.register('babele', 'CONFIG.DatabaseBackend._getDocuments', async function (wrapped, ...args) {
        const result = await wrapped(...args);
        if(!game.babele) {
            return result;
        }

        if(!await game.babele.init()) {
            return result;
        };

        const documentClass = args[0], query = args[1].query, options = args[1].options, index = args[1].index, pack = args[1].pack, user = args[2];
        if(!pack || !result || !game.babele.isTranslated(pack)) {
            return result;
        }

        if(index ?? options?.index) {
            return game.babele.translateIndex(result, pack);
        } else {
            return result.map(data => {
                return new documentClass(game.babele.translate(pack, data.toObject()), {pack});
            });
        }
    }, 'WRAPPER');

    /**
     * Necessary to solve a problem caused by the replacement of the index, even if already present, after reading the document.
     */
    libWrapper.register('babele', 'foundry.documents.collections.CompendiumCollection.prototype.indexDocument', function (wrapped, ...args) {
        const document = args[0]
        const id = document.id;
        const idx = this.index.get(id);
        // needed to fix pack index that is generated from links in chat
        const flag = document.flags?.babele ?? {};
        wrapped(...args);
        this.index.set(id, foundry.utils.mergeObject(
            this.index.get(id), 
            {
                ...idx, 
                ...flag
            }));
    }, 'WRAPPER');
}