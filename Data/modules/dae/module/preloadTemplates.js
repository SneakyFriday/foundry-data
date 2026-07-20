export const preloadTemplates = async function () {
    const templatePaths = [
        "./modules/dae/templates/ActiveEffects.hbs",
        "./modules/dae/templates/DIMEditor.hbs",
    ];
    return foundry.applications.handlebars.loadTemplates(templatePaths);
};
